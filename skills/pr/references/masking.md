# Masks: Object Mask, shape masks, tracking

Premiere has no scripting API for masks (ExtendScript none; UXP 26.3+ only detects them:
`detect_object_masks_uxp`, `audit_object_masks_uxp`). On macOS the `masks` operations drive Premiere's
UI for you: the agent looks at a frame and points at what to mask. Elsewhere → the click path below.

## Object Mask by the agent (macOS, `masks` category)

The app that runs this MCP server (Claude Desktop, Cursor, Terminal …) needs **Accessibility** and
**Screen Recording** (System Settings → Privacy & Security). Premiere comes to the front and receives
real clicks: the user keeps hands off mouse and keyboard while an operation runs.

1. **Prepare.** `create_sequence_checkpoint` + `pr_save_project`. Select the clip (`set_clip_selection`)
   so Effect Controls shows it; Program Monitor at «Fit». Clip Opacity 100 % first if it is lower (a mask
   on a semi-transparent clip cannot be judged; restore the value afterwards). Apply the effect the mask
   should drive first (Gaussian Blur, Mosaic …): its row is `effect_index` — 0 Motion, 1 Opacity
   (default), 2 Time Remapping, 3… added effects in Effect Controls order.
2. **Look.** `set_playhead_position` on the frame where the subjects are clearest → `pr_export_frame`
   at that playhead → choose points and lassos in that PNG's pixels.
3. **Create** — `object_mask_ui {frame_path, points | lassos, effect_index, track}`:
   - a **point** (click) takes the WHOLE object under it — a whole person;
   - a **lasso** (closed outline, 8–16 points) takes only the outlined **part** — a face, a head,
     hands. For a part never click the figure. The selection mode under the Program Monitor must be
     Lasso (the dropdown next to ⊕/⊖).
   - every further shape goes into the same mask (⊕); `subtract_points` / `subtract_lassos` remove (⊖,
     clicks remove more reliably than lassos);
   - optional `feather`, `expansion`, `inverted`; `track` forward (default), both or none;
   - returns `maskIndex`, the red-overlay extent in frame pixels (`bboxFrame`, `areaFrac`) and the
     overlay image — look at it before going on. `dry_run` locates everything without clicking.
4. **Check other frames.** Move the playhead 120–240 frames away (and near the ends), export the frame,
   `object_mask_select_ui {mask_index}` → `inspect_object_mask_overlay_ui {frame_path}`. A part lost on
   a frame → fix it **on that frame** (`object_mask_edit_ui {mode:"add", …}`), then
   `object_mask_track_ui` from there (forward / backward / both).
5. **Tune** — `object_mask_params_ui {mask_index, feather, expansion, inverted}`.

Rules:
- Mask only what the user named. "All people" means every person — partly hidden ones and fragments
  at the frame edge too; a doubtful fragment is checked on frames 120–240 away.
- Faces first: where tracking loses parts of bodies that cannot be restored, heads and faces must still
  hold on every frame. The mask edge never crosses eyes, nose or mouth — only cheeks may be clipped;
  when it does, enlarge the mask (expansion −10 → −4). Feather is a separate decision, set by the
  margin between the mask edge and the silhouette: the smallest value that hides the seam, down to 0
  when the feather would run past the silhouette or when the seam is hidden by the colour match of
  the layer underneath — a wide feather softens the facial features under it.
- Fragments count: every visible fragment of a subject (an arm, half a face, a leg between others)
  gets its own ⊕ — a fragment left out is not picked up when the camera or the people move.
- ⊖ hugs only the excess: outline the piece of background to remove tight around it, never together
  with the head or object next to it, so the mask knows which edge to keep. A click ⊖ on flat
  background (a wall, a panel, the ground) removes nothing — it is not an object for the model; in
  that case the tracked composite is checked frame by frame and the user is told where the leftover
  is. Every ⊕/⊖ needs the mask row selected at that moment, otherwise a second mask is created.
- A stretch where the mask refuses a head or an object: cut it as its own clip with ~2 s overlap
  on each side and mask it separately — short pieces track better.
- Know when to stop: once every requested subject and every face holds, finish. At most two re-seed
  rounds per shot and about ten minutes per piece — then report what remains instead of iterating.
- Results are `committed_unverified`: the overlay sees one frame; motion is checked by exported frames.
  Premiere drops the mask selection after tracking or a playhead move — the operations re-select by
  `mask_index` (mask rows in Effect Controls from the top). Undo is Premiere's own Edit › Undo.
- Icons are found by template matching (independent of the UI language); verified at 1:1 on 26.5,
  Retina by template scaling. A failure after clicks reports `mutationOutcome: "unknown"` — look at
  the overlay before retrying.

## Object Mask (26.0+, the default mask tool)

Click path: toolbar **Object Mask tool** (Rectangle, Ellipse and Pen masks sit under it — click and
hold) → hover in the Program Monitor highlights objects → click one; or switch the selection mode to
Rectangle / Lasso (dropdown under the Program Monitor) → **+** adds, the button next to it subtracts
(Option/Alt toggles) → track in Effect Controls: one frame, forward, backward, or "Track selected
mask forward and backward".

- First use downloads the models (Progress panel); the tool stays disabled until they finish.
- Start on the frame where the subject is most clearly visible.
- Modes: **Sharp** (binary edges) · **Smooth** (hair, fur, fabric, semi-transparent detail).
- 26.5: **Sharpness** slider refines edges without re-tracking; more objects selectable per scene.
- Beta 27.0, Smooth Mask section: Sharpness modes S-Curve (Contrast, Midpoint) or Levels (Input Black, Input White, Gamma); **Expansion** centred on 0 — negative removes halos, positive recovers edge pixels. Sources disagree whether Expansion is in the 26.5 release → look in the UI.
- 26.5.1 on macOS: users report a hang after the first mask.

## "The mask does nothing" — assignment
- A new mask is **Unassigned** and affects nothing. Select the target property (Opacity or an effect) in Effect Controls first, then draw — the mask is assigned to it. Or drag the mask onto the property.
- An effect added after the mask (Gaussian Blur …) nests the mask under itself.
- So for a masked effect: `apply_effect` by script first → the user selects that effect → draws the mask.
- Face blur: Mosaic (26.5 adds a **Softness** control) or Gaussian Blur as the masked effect.

## Shape-mask keyframes
- Default mode **Clip** changes the whole clip; to animate the shape per frame switch to **Frame**. Object masks have no Clip/Frame toggle — they are tracked.
- Deselect the mask before playback; a selected mask over a blur previews red.

## Mask data lives outside the .prproj
- Folder "<Project Name> Masks" next to the project file. Missing → masks offline ("Missing mask data" → Locate / Not now); locating it once restores every mask in it.
- 26.3: **Restore Mask Data** for moved projects. Beta: banner "Missing mask files…" → Locate / Restore (regenerates from source) / Later.
- Do not use `consolidate_and_transfer` (Project Manager) on projects with masks — it does not relink them (bug, 26.2.2 / 26.3.2); copy the Masks folder by hand when moving, archiving or sharing.
- Collaborators on different Premiere versions do not see each other's masks → same version.

Sources: helpx.adobe.com/premiere/desktop/add-video-effects/work-with-masks/object-masking;
provideocoalition.com «Tool Tip Tuesday … mask tool changes to know»; Adobe Community 26.5 release
notes and "Now in beta: improvements to Object Mask".
