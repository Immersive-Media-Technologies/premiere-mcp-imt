# Recipes that combine tools

[S] = by script through PR-MCP-IMT, [U] = UI step (SKILL.md §5). Safety net and verification:
SKILL.md §2. Feature details live in the reference section named in each step.

## 1. Generated shot between two clips (first/last frame)
1. [S] A gap of the needed length between the clips: an existing gap, or move the later clips on every synced track right by the gap length, last to first (`move_clip`). Length limits per model: generative.md §Generate Video.
2. [U] Generative Media Tool over the gap; First Frame = outgoing clip's last frame, Last Frame = incoming clip's first frame; Reference Frames from neighbouring clips to match colour and lens (generative.md §Generate Video).
3. [S] `pr_export_frame` at both seams.

## 2. Handles for a transition
1. [S] Free space after the outgoing clip (move the following clips right, as in 1).
2. [U] Generative Extend on the outgoing tail (generative.md §Generative Extend).
3. [S] Move the following clips back over the generated part so it becomes a handle (unverified that generated frames act as handles), then `add_transition` at the cut.

## 3. Sound effects timed by voice
1. [S] `add_marker` on the action frames; an empty audio-track region of the needed length.
2. [U] Generate Sound Effects with Record a Guide or Sync to Video (generative.md §Generate Sound Effects).

## 4. Interview: transcript → Paper Edit → pauses → Morph Cut
1. [U] Transcribe (speech-text.md §Speech to Text).
2. [U] Paper Edit → new sequence (speech-text.md §Paper Edit) → [S] `set_active_sequence` to it, checkpoint.
3. Pauses and fillers: [U] one by one (speech-text.md §Text-based editing), or [S] `plan_pause_tightening` / `plan_filler_word_removal` → speech-text.md §Cut route, mapping each source range per placement.
4. Jump cuts: [S] Morph Cut where it fits (timeline-automation.md §Morph Cut); elsewhere a cutaway, or a punch-in: `plan_emphasis_zoom_keyframes {trigger_seconds: <cut times, clip-relative>, frame: {width:1920, height:1080}}` → `add_keyframe`.
5. [S] Test export around the Morph Cuts (timeline-automation.md §Morph Cut).

## 5. Face or plate blur that follows the subject
1. [S] `apply_effect` Mosaic or Gaussian Blur on the clip.
2. [U] Object Mask assigned to that effect, tracked both ways (masking.md §Assignment, §Object Mask).
3. [S] `pr_export_frame` at start, middle, end and on fast motion.

## 6. Storyboard to sequence
1. [U] Firefly Boards → sequence (generative.md §Firefly Boards).
2. [S] `set_active_sequence`, `pr_get_sequence`, set durations; [U] Generative Extend where a clip is too short.
3. [S] Later replace placeholders with real footage (`replace_clip`), keeping timing.

## 7. Remove music recorded on location (Content ID)
1. [U] Enhance Audio stems on the dialogue clips → mute the Music stem, or Split to Clips (audio.md §Enhance Audio).
2. [S] Remove or mute the music stem clips; the user listens.
3. [U] Generate Music or a licensed track → [S] `setup_ducking` under the dialogue (audio.md §Ducking) → after export `verify_delivery_conformance {output_path, target_lufs}`.

## 8. Social versions of a finished edit
1. [S] `plan_platform_delivery_matrix {source, targets}` first — sizes, durations, safe zones per platform.
2. [S] `auto_reframe_sequence` per target (timeline-automation.md §Auto Reframe) → `set_active_sequence` each → re-place titles; captions and safe zones: speech-text.md §Captions.
3. [S] `export_sequence` per target → `verify_delivery_conformance {output_path, width, height, frame_rate, …}` → `validate_platform_publish_package`.

## 9. Rough cut by silence, no transcript
1. [S] `detect_silence` on each source file → keep the silences inside [clip.in, clip.out] of each placement → sequence time.
2. [S] Review first (`plan_silence_review_markers` → `add_markers_batch`), then remove the silences by the speech-text.md §Cut route. With UXP: `create_silence_cut_source_stringout_uxp`.
3. External alternative: `auto-editor <file> --export premiere` (XML) → `import_fcp_xml {path, project_path}` opens it as a new project → `open_project` the main project → `import_sequences {project_path, sequence_ids}`.

## 10. Music-driven montage
1. [S] `detect_beats` on the music file; choose where the music will start (S) → beat sequence times = S + t − music in-point.
2. [S] `plan_beat_montage {beat_seconds, clips, frame_rate}` → apply its `add_to_timeline_batch` chunks, trim ranges (`trim_clip` / `set_item_in_out`) and markers (`add_markers_batch`).
3. [S] Inserts ripple sync-locked tracks → add the music last, at S (`add_to_timeline {scope:"target_tracks"}`), then `pr_get_sequence`.

## 11. Slates and multicam with the AI Assistant (beta)
[U] Assistant: slate detection → markers; multicam sync (search-assistant.md §AI Assistant) → [S]
`pr_get_sequence`, `list_markers`, continue by script.
