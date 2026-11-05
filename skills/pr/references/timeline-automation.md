# Auto Reframe, Scene Edit Detection, Morph Cut, Color Match, Warp Stabilizer, Time Remapping

## Auto Reframe
`auto_reframe_sequence {sequence_id?, target_width, target_height, motion_preset: slower|default|faster, new_name, use_nested_sequences}`
— pixels: 9:16 = 1080×1920, 1:1 = 1080×1080, 4:5 = 1080×1350. Creates a new sequence and leaves the
original; the new one is not activated (SKILL.md §3). Refine the Auto Reframe effect's keyframes in
Effect Controls (UI).
- Run on a locked edit. Titles and captions are reframed with everything else → re-place them (safe zones: `speech-text.md` §Captions).
- Verify faces and action with `pr_export_frame` at several points of the new sequence.

## Scene Edit Detection (acts on the selection)
`scene_edit_detection {action: CreateMarkers (default) | ApplyCuts, apply_cuts_to_linked_audio, sensitivity: LowSensitivity | MediumSensitivity (default) | HighSensitivity}`.
- UI fallback: Clip › Scene Edit Detection; it also offers "Create a bin of subclips" and cuts linked audio → unlink first if the audio must stay whole.
- UXP: `detect_scene_edits {mode: apply_cuts | create_markers | create_subclips, confirm_non_undoable:true}`.
- Without Premiere: `detect_source_scene_changes {media_path, threshold}` (FFmpeg scene scores, source seconds).
- Use: a flattened master or a reference export → cuts or markers per shot → regrade or reconform shot by shot.

## Morph Cut — hides a jump cut in a talking head
UI: Effects › Video Transitions › Dissolve › **Morph Cut** on the jump cut → wait until "Analyzing in
background" clears.
- Script (untested for Morph Cut): `add_transition {transition_name:"Morph Cut", track_index, cut_point_seconds, duration_seconds}`; the English name works on any UI language (SKILL.md). Confirm with `get_full_sequence_info`; if refused, the user applies it from the Effects panel.
- Works with one talking head, static camera and background, short clips. Moving camera or background → a cutaway or a punch-in instead.
- Failures: the banner never clears; preview is right but the export is a plain dissolve. Fixes: sequence frame rate = source frame rate; nest clips scaled differently from the sequence; transcode long-GOP media; Render and Replace before export.
- Check after the analysis finished: `set_work_area` around the cut → `export_sequence {output_path, work_area_only:true}` → look at the file.

## Color Match (Lumetri)
Lumetri Color › Color Wheels & Match › Comparison View → choose the reference frame → optional Face
Detection → **Apply Match**. Writes editable wheel and luma values.
- Script: `color_correct`, `apply_lut` apply Lumetri; `get_effect_properties` reads the matched values; `plan_shot_match` compares two local frames (waveform, parade, saturation deltas) and suggests correction directions.

## Warp Stabilizer
`stabilize_clip {node_id, smoothness, method}` applies the effect; analysis runs in Premiere in the
background; `inspect_stabilizer_status` reads presence and analysis state.

Sources: helpx «detect edit points using scene edit detection», adobe.com/learn «auto reframe for
socials», «automatically match color», «interview footage»; Adobe Community «Morph Cut analyzing in
background never completes».

## Time Remapping — speed keyframes by the agent (macOS, `keyframes` category)
No script can set a clip's speed or its speed keyframes (ExtendScript / QE read only; `speed_change`
and `set_clip_speed_qe` always refuse). `time_remap_ui` does it through Premiere's UI, like the masks
operations: the app that runs the server needs Accessibility and Screen Recording, Premiere comes to
the front, hands off mouse and keyboard while it runs.
- **Say what you want as points:** `time_remap_ui {node_id, points: [{source_seconds, sequence_seconds}…]}`
  — "this media frame plays at this sequence time". The clip must run at 100 % with no speed keyframes
  yet (otherwise it refuses before any click). Each point becomes a speed keyframe on that media frame;
  the segment to its left gets Δsource / Δsequence (from the clip start for the first point); after the
  last point the clip runs at 100 % and gets longer or shorter — it must not run into the next clip on
  its track (make room first). Speeds 10–1000 %; times snap to sequence frames. A ramp (gradual change)
  is not produced — the keyframes are hard steps; split a ramp into several points.
  Example: a clip at 0 s, in-point 0, media 1–2 s at 50 %, then 100 % again:
  `points: [{source_seconds:1, sequence_seconds:1}, {source_seconds:2, sequence_seconds:3}]`.
- **How it works:** the keyframes are added with Effect Controls › Time Remapping › Speed › ◇ at a
  script-set playhead (each on its media frame while the clip is still at 100 %), then each handle is
  Shift-dragged on the timeline onto the playhead parked at its target, zooming in with «=» until one
  pixel is finer than `tolerance_frames` (default 0.1). The clip must show Time Remapping › Speed on the
  timeline — the operation switches it through the clip's fx badge menu, and makes the tracks taller if
  the track draws no keyframes.
- **Check:** the result reports each keyframe's speed and measured offset (frames), the clip end read back
  against the expected one (`endMatches`), the handles counted on the timeline, undo indexes (one Undo
  step per click and drag) and a timeline image. Rendered timing: `pr_export_frame` at a sequence time
  and compare with the media frame it should show (`ffmpeg -ss`). `inspect_time_remap_ui {node_id}`
  (read-only) measures where the keyframes sit now.
- `dry_run: true` returns the plan (speeds, where each keyframe is added and placed) without clicks.
- Alternatives without the UI: cuts + `slip_edit` per piece (no speed change, jumps at the cuts), or
  a retimed render (FFmpeg, per-segment speed) → `replace_clip_media`.
