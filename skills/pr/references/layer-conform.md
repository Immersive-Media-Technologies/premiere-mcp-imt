# Layer conform: sync a generated layer with the plate (time → geometry → colour → mask)

Open this reference when two video tracks show the same scene and must coincide on the people before
compositing: «синхронизировать слои / дорожки», «подогнать фон под плейт / под людей», «замена фона»,
«свести цвет слоёв», «маска на людей, шов». Typical case: the upper track is the plate (people to keep,
often on green), the lower track is an AI generation of the same shot (new set, its own rendering of
the same people). The rim along every silhouette comes from the lower track, so the lower track must
coincide with the upper one in **time, geometry and colour** — otherwise the rim reads as an outline.

Not this reference: grading one clip, masking one object for an effect (`masking.md`), stabilisation,
a plain speed change (`timeline-automation.md`).

## 0. What the generator does (model, not numbers — measure every clip again)

Measured on three shots (30.10–04.11.2026, Premiere 26.5, 4608×3164):

| | what to expect | search range |
|---|---|---|
| time | the generation plays the action **faster** by ≈ 8–9 % (+1 frame every 9–15 frames), reaches the end early and **freezes** for the last 5–8 frames; steps are uneven (a repeated or skipped frame happens) | segment speed 100–115 % |
| geometry | one uniform scale per clip (100.5–101.5 %) plus a shift of a few px; rotation and width/height difference negligible; a short transitional section (5–8 frames) may differ by 0.2–2 % | scale 99–102 %, shift ±40 px, rot ±0.5°, aniso ≤ 0.3 % |
| colour | the generation is a few levels lighter/redder; a per-channel linear transfer (Levels) fixes it to ±1 level | gain 0.9–1.1, offset ±15 levels |

A value outside its range is a reason to re-check the measurement, not to apply it.

Hard rules: **time before pixels** (a temporal drift cannot be fixed with geometry; a per-frame fit
without time sync fits noise) · **phase vs width** (some people coincide and others double → the
timing is right and the width/position is off: scale and shift until *everyone* coincides, never fit
one person) · **one constant per piece** (per-frame keys only where the parameters move by more than
~0.2 % inside a piece) · the reference track for geometry is the user's call per shot — ask when the
request does not say · the mask always goes on the **upper** clip, the colour match on the **lower**
clip towards the upper · the user's edits between turns are kept: re-read the sequence every turn.

## 1. Tools

| step | tool |
|---|---|
| numerics | `conform.py` (this skill's `scripts/conform.py`; needs Python 3 + `numpy` + `opencv-python-headless`, FFmpeg for `frames`/`render`). It measures PNG frames and writes JSON plans; it never talks to Premiere. |
| frames of one track | `toggle_track_visibility` (solo) → `export_sequence {preset_path, range:"in_to_out"}` to a PNG sequence (8-bit for measuring; ProRes 4444 XQ → `conform.py frames --bits 16 --alpha` for the final resample) → restore visibility; single frames: `pr_export_frame` (straight alpha). Raw media frames of the lower clip: `conform.py frames --video` + the clip's Motion as `--mov-place "scale=161;pos=0.503,0.540"` with `--seq-size W,H`. |
| time | `time_remap_ui {node_id, points}` (speed keyframes, macOS) — `conform.py time-plan` writes the `points`; fallback `split_clip` + `slip_edit` per constant-lag run (`cut_and_slip` in the same plan); `freeze_frame` for the frozen tail |
| geometry | Motion on the moving clip: `set_effect_property` (Scale Width / Scale Height with Uniform Scale off, Rotation, Position normalised 0–1) for a constant per piece; `add_keyframe` per sampled frame when the piece needs keys. Warp render (route C): `conform.py render` → `import_media` → `replace_clip_media` |
| colour | Levels («Уровни») on the lower clip: `apply_effect` + `set_effect_property` per channel (Input/Output Black/White; names from `get_effect_properties`); Lumetri only when Levels cannot express the transfer |
| mask | `object_mask_ui` / `object_mask_edit_ui` / `object_mask_track_ui` / `object_mask_params_ui` on the upper clip (see `masking.md`); measure with `conform.py mask-measure` on exported alpha |
| checks | `conform.py verify` on exported frames; `diff_sequence_snapshots`; `inspect_time_remap_ui` |

## 2. Stage 0 — state and safety

`pr_verify` → `pr_get_sequence` → `get_sequence_settings` (size, fps). Identify the upper and lower
clips by track order, never by name; note each clip's Motion, Opacity, speed and effects
(`list_clip_effects`, `get_effect_properties`). Ask which track is the geometry reference if the
request does not say (default: the lower generation is warped onto the plate; on shot 009 the plate
was slipped onto the generation — both happen). `create_sequence_checkpoint {label}` + `pr_save_project`.
Set in/out to the shot (`set_sequence_in_out_points`); record track visibility and restore it after
every export. Working folder: `<project folder>/DA_render/conform/<shot>/` (never a chat cache).

## 3. Stage T — time (first, always)

1. **Frames.** Export the reference track alone and the moving track alone as PNG sequences over the
   same in/out range (same frame count; frame i of both = sequence frame in + i). Straight alpha is
   handled (frames are composited over black inside the engine).
2. **Coarse geometry first.** `conform.py coarse-fit --ref REF/ --mov MOV/ --out S/ --frames 0,2,4,6`
   (frames at the shot start, where the lag is still 0). A 1.4 % scale error cost 1–2 frames of timing on
   shot 009 — never match time on unscaled frames. `in_range:false` → check the placement arguments.
3. **Match.** `conform.py time-match --ref REF/ --mov MOV/ --out S/ --geom S/coarse.json --lag-min -3 --lag-max 10`
   → `S/time.json`: `lag[t]` (moving frame = t + lag), `runs` of constant lag, `points` (coincidence
   points: the middle of every stable run), `segments` with speeds, `frozen_tail_ref/mov`, `hold`,
   `warnings`. Similarity = NCC of normalised high-pass luma weighted by the moving layer's motion
   (static set carries no time information), path by dynamic programming (lag changes ≤ 1 frame per
   frame). Read `summary`: `in_model_range`, `disagree_with_free_best` (should be small),
   `low_margin_frames` (ambiguous frames), and every warning — «moving layer has N frames … forced»
   means the moving export is too short: export at least `max lag` more frames and match again.
4. **Plan.** `conform.py time-plan --time S/time.json --fps 24 --clip-start <moving clip start s> --clip-in <moving clip in-point s> --out S/plan.json`
   (`--range-start` when reference frame 0 is not the moving clip's start). Show the user the `table`
   (ref frame ← mov frame, sequence s, source s, segment speed) before applying anything.
5. **Apply — route B (default):** the moving clip must run at 100 % with no speed keys yet →
   `time_remap_ui {node_id, points: plan.time_remap_ui_points, tolerance_frames: 0.1}`; read back the
   result (`inspect_time_remap_ui`, the returned clip end against the expected one). Route A (no macOS
   / UI refused): `split_clip` at each `cut_and_slip[i].sequence_seconds[0]` on the moving clip, then
   `slip_edit` each piece by `slip_frames` (near the media end `slip_edit` refuses with «invalid source
   range» → set in/out in ticks through `pr_execute_script`). Route C: `conform.py render --time` makes
   a retimed media file → `replace_clip_media`.
6. **Tail.** When `hold` is set (the reference freezes while the moving layer still acts): after the
   last speed key the moving clip must hold too → `freeze_frame` on the moving clip at
   `plan.hold.sequence_seconds_from` (or cut there and hold the last matching frame). Report the frames.
7. **Verify.** Export the moving track again over the range → `conform.py verify --ref REF/ --mov MOV2/ --check-time --report S/t8.json`
   (lag 0 now): every frame must win against its neighbours ±2 (`time_lost_frames` empty; ties at cut
   points are allowed and listed). Jumps are judged by the user on playback — stills do not show them.

## 4. Stage G — geometry (affine per piece; warp render only when affine fails on named people)

1. `conform.py global-fit --ref REF/ --mov MOV/ --out S/ --time S/time.json --step 2 --mov-motion <scale_w,scale_h,pos_x,pos_y[,rot]> --seq-size W,H [--boxes boxes.json]`
   → `S/geom.json`: one entry per piece (constant-lag run): `mode: constant | keys`, `delta` (what to
   apply on top), `motion` (the absolute Motion values composed with `--mov-motion` — the clip's
   current Scale/Position/Rotation), `resid_px`, and per-person offsets before/after when `--boxes`
   (normalised `{name:[x0,x1,y0,y1]}` of every person) is given. Residual ≈ 1.6–2 px median is the
   level reached live; `pieces_with_keys` should be 0 or only transitional pieces.
2. **Per-person check is mandatory** (`person_check`): the whole-frame number hid a doubling woman on
   shot 109. Verdict «R10» → the phase is right, the width/position is off: re-fit with the doubling
   people's boxes, never accept the frame statistic. Verdict «all people off» → back to Stage T.
3. **Apply** on the moving clip: constant piece → `set_effect_property` Motion › Scale Width / Scale
   Height (Uniform Scale off), Rotation, Position (normalised `motion.pos`); a `keys` piece →
   `add_keyframe` at each `keys[i].t` (sequence time = range start + t/fps) for the four properties;
   a clip cut into pieces by route A gets its own values per piece (pieces map 1:1 to the cuts).
   Before re-setting keyed properties remove the old keyframes (`remove_keyframe_range`).
4. **Verify** on a fresh export of the moving track: `conform.py verify --ref REF/ --mov MOV3/ --boxes boxes.json --report S/g.json`
   → `geom_median_px`, `geom_p90_px`, per-box median/p90. Target: p90 ≤ 2 px on people; where a named
   person stays above it after the affine, go to the warp render (`conform.py render --geom` of a
   per-frame fit, ProRes 4444 → `replace_clip_media`), keeping the original media in the bin.
5. Transparent frame edges after scaling/shifting are reported by `render` (`transparent_edges_lrtb`)
   and visible as empty strips on the timeline: offer Motion › Scale +1–2 % on the lower clip or a
   fill — never apply unasked.

## 5. Stage E — colour (lower clip towards the upper)

1. Geometry first, then colour. `conform.py exposure --ref REF/ --mov MOV/ --out S/levels.json --time S/time.json --geom S/geom.json --every 3 --apply-to <mov|ref>`
   — `--apply-to` names the clip that gets the Levels (the **lower** one; `ref` when the lower clip is
   the time/geometry reference, as on shot 009 where the Levels went on V1). Pairs = pixels where both
   layers agree (local NCC > 0.55) and both are opaque — people and ground, typically 5–15 % of the
   frame; frames with < 3000 pairs are skipped and listed.
2. Output: `linear` (gain/offset per channel, 8-bit), `levels_per_channel` (Input Black/White, Output
   Black/White, gamma 1 — the form that keeps every value in 0–255), `levels_rgb_single` when the
   channels agree, `error_8bit` before/after (bias target ±1), `flicker_per_frame` (bias per frame —
   a drift over frames means the generator changed exposure mid-shot: split the clip and fit per piece).
3. **Apply:** `apply_effect {node_id, effect_name:"Levels"}` on the target clip → `get_effect_properties`
   once (the per-channel property names on this UI language) → `set_effect_property` for each of the
   twelve values that differ from default. Live example (shot 009, V1): R 4/250, G 2/248, B 4/244 input
   black/white, outputs untouched. Lumetri (`color_correct`) only when Levels cannot express the
   transfer; one container per clip, never both. Remove calibration effects after measuring.
4. **Verify** on an export of the lower track alone (not the composite): `conform.py verify … --report S/e.json`
   → `colour_bias_rgb_mean` within ±1, `median_abs` ≤ 2 levels. Sky, trees and buildings of a
   generated set have nothing to compare with — say so; the same curve is applied to them untested.

## 6. Stage S — mask and seam (upper clip)

1. Opacity of the upper clip to 100 % first if the alignment stage left it lower (say the old value).
2. People: `object_mask_ui` on the upper clip's Opacity — one point per person **and** per visible
   fragment of a partly hidden person (legs, a shoulder, a hand at the edge); a doubtful fragment is
   checked on frames 120–240 away before deciding; a part of a figure (a face, hands) only with a lasso.
   Ground and shadows are not «objects» (clicks on asphalt add 0 px): the user draws a Pen mask, or a
   matte goes through Track Matte Key. Then track; check the overlay on 4–6 frames including the ends;
   a lost part is fixed **on that frame** and tracked again from there (≤ 2 re-seed rounds, ~10 min per
   piece; faces and heads first on every frame, then torso, then limbs).
3. Seam: `object_mask_params_ui {mask_index, expansion, feather}` — Premiere's scale is its own (≈ −13 /
   3–4 at 4608 px with large figures, 0–1 for small ones, 0 with glow; never Photoshop's 3/1). Measure
   on 3 frames: export the alpha at expansion 0 / feather 0 once, then at the final values →
   `conform.py mask-measure --mask0 M0.png --mask M.png [--mask-prev Mprev.png] --report mask.json`
   → `inset_px` (median/p10/p90 of the 50 % contour), `transition_px` (10–90 % width per perimeter),
   `opaque_from_px`, `jitter_vs_prev_px` (target std < 0.5 px), `lost_subject` (area drop > 30 %
   between neighbouring frames without a cut). Quote the measured width, not the parameter.
4. Composite check: a short `export_sequence` of the composite → contact sheet; seam band
   |composite − upper| at 4–6 silhouette spots; transparent pixels where the warped lower clip left
   empty edges; stray clips/effects above the stack.

## 7. Reporting and acceptance

Measured on exported frames only, before → after: time (gain in frames, segment speeds, frames lost
in T8), geometry (median / p90 / worst frame, per person), colour (bias per channel, median abs,
per-frame drift), mask (inset, transition, jitter, frames re-seeded). Accept when: no frame loses in
T8; geometry p90 ≤ 2 px on people (or the best reached value with the reason — redrawn content,
parallax); colour bias ≤ 1 level; every person in the mask on every frame with faces holding; no
unreported transparent area. Out of scope: relighting, parallax between layers from a moving camera (a
smooth warp cannot fix it — report and stop), audio. Checkpoint sequence untouched; original media
stays in the bin; `pr_save_project` only after the user accepts.

## 8. After Effects

The same engine runs for AE (`AE-MCP-IMT` skill, recipe `layer-conform.md`): frames from
`render.frame` / a solo render of each layer, time through Time Remap keyframes (`plan.ae_time_remap_keys`:
comp time → source time, a hold key at `hold`), geometry through Transform (Scale per axis, Rotation,
Position = `motion.pos_px`), colour through Levels (Individual Controls) with the same Input/Output
values, mask through roto/`layer.set_track_matte`.
