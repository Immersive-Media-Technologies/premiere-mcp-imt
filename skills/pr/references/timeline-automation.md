# Auto Reframe, Scene Edit Detection, Morph Cut, Color Match, Warp Stabilizer

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
- Script (untested for Morph Cut): `add_transition {transition_name:"Morph Cut", track_index, cut_point_seconds, duration_seconds}`; on a localized UI the name is localized (SKILL.md §3). Confirm with `get_full_sequence_info`; if refused, the user applies it from the Effects panel.
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
