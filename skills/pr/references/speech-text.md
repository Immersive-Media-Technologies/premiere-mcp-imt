# Speech to Text, text-based editing, Paper Edit, captions

## Routes by bridge
- **CEP (default):** no transcript read or write, no transcription start. Server transcript tools are planners over a word timeline you supply (§Planners).
- **UXP bridge:** `transcribe_clip_uxp` (start; needs confirmation and an operation_id) · `has_transcript_uxp` · `get_clip_transcript_uxp` (native transcript JSON + revision) · `search_clip_transcript_uxp` · `import_transcript_uxp` (replaces a transcript; destructive) · `get_transcript_languages_uxp`, `is_language_pack_available_uxp` · `plan_transcript_rough_cut_uxp` · `preview_transcript_edit_uxp` · `preview_derived_dialogue_sequence_uxp` → `apply_derived_dialogue_sequence_uxp` (≤ 64 keep ranges per call) · `create_silence_cut_source_stringout_uxp`. Only source clips can be transcribed through UXP, not sequences.

## Speech to Text (UI)
Start: import dialog "Automatic transcription" · Project panel right-click › Transcribe · Text panel ›
Transcribe / Transcribe Sequence. Multichannel audio: choose a channel or the mix.
18 languages (incl. Russian); language packs; offline once the pack is installed; no usage limit.
Clips transcribed before filler detection existed must be re-transcribed to get `[filler]` tokens.

## Text-based editing (UI)
- Deleting transcript text deletes the media and ripples the sequence.
- Pauses / fillers: Transcript filter icon › **Pause** or **Filler** → matches highlighted → Delete → **Extract** (ripple) or **Lift** (leave a gap). Thresholds: ⋯ › transcript view options.
- **Delete All** also removes intentional pauses and detection is imperfect → delete one by one after review.
- Audio-only removal: lock the video track, use Lift.

## Paper Edit (26.5)
Click path: Text panel (or Text-Based Editing workspace) › Transcript tab › **Paper Edit** icon.
Works on a transcribed source clip or sequence. Select sentences/fragments ("Selected Duration" bar
sums them; click a selection to drop it, Clear drops all; arrows jump between selections) →
**Preview** → **Create new sequence** → "<source> - Paper Edit".
- Clip order in the result: source order per one review, edit order per another — check the result.
- No reordering, cut/copy or search inside Paper Edit; Preview cannot pause; selections are lost when leaving Paper Edit.
- Reported failures: multicam sources, sources with more than one audio track.
- Reorder afterwards on the timeline, or open the result in the Source Monitor and cut from there.

## Planners (any bridge)
`word_timeline` = `{source_project_item_id, transcript_revision, words:[{text, start_seconds, end_seconds, speaker_label?, confidence?}]}`, source seconds, ordered by start.
- From UXP: `get_clip_transcript_uxp` gives words and the revision.
- Without UXP: any word-timed transcript (a Premiere transcript export, an external recognizer) mapped to that shape. `transcript_revision` = `"sha256:"` + 64 hex of your words JSON — only the pattern is checked; keep it stable so stale plans are detectable. `source_project_item_id` = the source item's node id.

| operation | input → output |
|---|---|
| `plan_filler_word_removal` | word timeline → removal/keep ranges for fillers (default list; "like" only when listed) |
| `plan_pause_tightening` | word timeline → shortens pauses > `max_pause_seconds` to `target_pause_seconds` (sentence ends keep `sentence_pause_seconds`); never deletes a pause |
| `detect_repeated_takes` | word timeline → retake groups, keeps `last` or `first` |
| `plan_word_mute_ranges` | word timeline → mute or bleep ranges + `add_audio_keyframes` payloads in source seconds → convert to clip-relative (t − clip.in), verify with `get_keyframes` |
| `analyze_dialogue_edit_candidates` | `segments` (+ `silence_ranges` from `detect_silence`) → edit candidates |
| `plan_emphasis_zoom_keyframes` | word timeline (default trigger `sentence_start`; `trigger:"emphasis_words"` + `emphasis_words` for emphasis) or `trigger_seconds` → punch-in Scale/Position keyframes; output frame defaults to vertical 1080×1920 |
| `build_caption_artifact` | word timeline → SRT/VTT (§Captions) |

## Cut route (apply removal ranges)
- UXP: `preview_derived_dialogue_sequence_uxp` → `apply_derived_dialogue_sequence_uxp`.
- CEP, on a checkpointed sequence, per removal range from the last to the first, in sequence time:
  `razor_all_tracks {time_seconds}` at both boundaries → `pr_get_sequence` → `ripple_delete {node_id: <piece on the dialogue track>, range_content:"delete", dry_run:true}` → check the reported shift → the same call without `dry_run` → `pr_get_sequence`.

## Captions
- UI: Text panel › Captions › create from the transcript. Layout **Single Word** (26.3): one word per caption, synced to the audio, styled and exported like other captions. No karaoke highlight; pop-in animation → upgrade the captions to graphics and add Transform.
- Export: sidecar SRT / SCC / MCC / STL / DFXP or burn-in (export settings). Caption translation runs in Adobe's cloud.
- Script: keep only words inside [clip.in, clip.out] and shift them to sequence time in the word timeline → `build_caption_artifact {word_timeline, format:"srt", output_path, approved_workspace_path}` (`words_per_cue:1` = single-word captions without the UI) → `import_media` the .srt → `find_project_item_by_name` → `create_caption_track {item_id, caption_format:"subtitle", start_seconds:0}` → styling in the UI. Caption text cannot be read back by script (`read_sequence_captions` / `inspect_caption_tracks_uxp` enumerate tracks only).
- Social overlays: `check_caption_safe_zone {platform, frame, elements}` checks rectangles you measure (normalized 0–1, e.g. on a `pr_export_frame`); it does not read the sequence. Presets: `get_caption_style_guidance`.

Sources: helpx.adobe.com/premiere/desktop/ — add-text-images/insert-captions/auto-transcribe-video-using-speech-to-text,
…/insert-captions/create-single-word-captions, edit-projects/edit-video-using-text-based-editing/create-a-sequence-with-paper-edit;
redsharknews.com «how to delete pauses and filler words with text-based editing»; provideocoalition.com «… Paper Edit».
