# Masks: Object Mask, shape masks, tracking

UXP 26.3+ only detects masks: `detect_object_masks_uxp`, `audit_object_masks_uxp`.

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
