---
name: pr
description: Drive Adobe Premiere Pro through Premiere-MCP-IMT (pr_verify, pr_catalog, pr_do, pr_batch, pr_get_sequence, pr_export_frame) and use Premiere's AI tools — Generative Extend, Generative Media Tool, Object Mask, transcripts and Paper Edit, captions, Enhance Speech/Audio, Search, AI Assistant, Auto Reframe, Scene Edit Detection, Morph Cut — on localized Premiere in any UI language too. Read at the start of any Premiere task. This file is the router; open only the reference it points to.
revision: 2
updated_at: 2026-10-26
---

# Premiere Pro — agent skill

Scope: controlling Premiere through Premiere-MCP-IMT, where scripting ends, which reference to read.
Facts: Premiere 26.5 (Sep 2026) and Premiere (Beta) 27.0, checked 2026-10-26.

## 1. Tools

| tool | use |
|---|---|
| `pr_verify` | First call of a session: connector reachable, project open, sequence active. |
| `pr_install_connector` | `pr_verify` → connector unreachable while Premiere runs: `{action:"status"}`; files missing → ask the user → `{action:"install"}` → user quits and reopens Premiere → `pr_verify`. |
| `pr_get_sequence` | Active sequence: tracks and clips with `node_id`, start/end/in/out (s), speed. Its output is the `get_sequence_structure` snapshot. Re-read after every structural edit — node_ids and times shift. |
| `pr_catalog` | No arguments: every operation name by category (once per session). `{category}`: parameters. |
| `pr_do {operation, args}` | Run one operation. Keyword search when the category is unknown: `pr_do get_capabilities {tool_query:"<keywords>", tool_limit:10, available_only:false}` (large reply; `available_only:false` also shows `_uxp` operations). |
| `pr_batch {ops, stopOnError}` | Several operations whose args are all known up front (a batch cannot pass a new node_id on). Stops at the first error by default; not atomic — earlier steps stay applied. |
| `pr_export_frame {output_path, time_seconds}` | PNG of a sequence frame. No file access → `pr_do capture_frame {time_seconds}` returns the image inline. |
| `pr_save_project` | After verified changes and before exports. |
| `pr_execute_script` | ES3 ExtendScript; listed only when enabled. Use only when no operation covers the step; never to bypass an operation that reports Unavailable. |
| `pr_skill {doc}` | A reference of this skill by file name without `.md`, e.g. `{doc:"generative"}`. |

## 2. Order of work

1. **State.** `pr_verify` → `pr_get_sequence`. Unfamiliar project: `get_full_project_overview {include_bin_tree:false}`, `get_offline_media`.
2. **Safety net.** No scripted undo: `undo`, `redo`, `multiple_undo` report Unavailable. Before a destructive or multi-step edit: `create_sequence_checkpoint {label}` (clones the sequence, returns a snapshot) and `pr_save_project`. Revert: `list_sequence_checkpoints` → `set_active_sequence` to the checkpoint (the original stays modified), or the user's Edit › Undo.
3. **Operate.** `plan_*` operations compute and never touch Premiere. Some `preview_*` operations return a token that the follow-up operation named in their description requires unchanged.
4. **Verify by values, then picture.** `pr_get_sequence` → `diff_sequence_snapshots {before: <checkpoint snapshot>, after: <pr_get_sequence output>}`; effects: `list_clip_effects`, `get_effect_properties`; picture: `pr_export_frame` at the changed frames. Audio and motion need playback — report them as unverified.
5. **Finish.** `pr_save_project`; report artifact paths and what stays unverified.

## 3. Addressing

- **Active sequence.** `pr_get_sequence`, `pr_export_frame`, exports and most edits act on it. Operations and UI tools that create a sequence (Auto Reframe, Paper Edit, Firefly Boards, duplicates) do not switch to it → `set_active_sequence`, then checkpoint it.
- **Ids.** Clips: `node_id`. Tracks: 0-based index + `video|audio`. Project items: `find_project_item_by_name`.
- **Time bases.** Default: sequence seconds. Source seconds: FFmpeg analysis (`detect_silence`, `detect_beats` …) and word-timeline planners → sequence time = clip.start + (t − clip.in), valid only inside [clip.in, clip.out], at 100 % speed; one source placed several times needs the mapping per placement. Clip-relative: `add_keyframe`, `add_audio_keyframes`, `setup_ducking` windows, `plan_emphasis_zoom_keyframes {trigger_seconds}`. Each operation's parameter text names its base.
- **Frame rate.** Planners snap to `frame_rate`, default 30 → pass the sequence rate from `get_sequence_settings`.
- **Selection-driven operations** (`scene_edit_detection`, `remove_selected_clips` …) act on Premiere's current selection: `deselect_all_clips` → `set_clip_selection` / `select_clips_in_range` → confirm with `get_selected_clips`.
- **Cutting and rippling.** `split_clip` cuts one track; `razor_all_tracks {time_seconds}` cuts through linked audio. Inserts (`add_to_timeline`, `insert_from_source`) and `ripple_delete` shift sync-locked tracks by default; `target_tracks` (inserts) / `own_track` (`ripple_delete`) desync the rest. `remove_from_timeline` / `remove_selected_clips` leave a gap unless `ripple:true` — that flag is unverified on 26.x; prefer `ripple_delete`.
- **Any UI language.** Use English names for effects, transitions, components and parameters ("Gaussian Blur", "Cross Dissolve", "Motion" › "Scale") on every Premiere UI language: the server translates them through Premiere's own UI dictionaries and matches components by matchName. Results report the host's name (`effect: "Размытие по Гауссу"`, `requested: "Gaussian Blur"`); the lists (`list_available_effects`, `list_available_transitions`) give both. A name in the UI language works too. "Effect not found" means the effect is not installed or has another name in this Premiere version — not a language problem.
- **Modal dialogs** block the connector: on a timeout ask the user to close it, then re-read state before retrying — the outcome of a timed-out write is unknown.

## 4. Scripting boundary → reference

Most AI features have no scripting API (neither ExtendScript nor UXP); menu commands and keyboard
shortcuts cannot be triggered by script in Premiere 26. Operations ending in `_uxp` exist only with the
UXP bridge (`PREMIERE_UXP_TOKEN` + the UXP plugin in Premiere).

| feature | route | read |
|---|---|---|
| Generative Extend | UI, paid credits | `references/generative.md` |
| Generative Media Tool: video, sound effects, soundscape, music | UI, paid credits | `references/generative.md` |
| Firefly Boards → sequence | UI | `references/generative.md` |
| Object Mask, shape masks, mask tracking | UI; the effect the mask drives: `apply_effect`, `set_effect_property` | `references/masking.md` |
| Speech to Text, text-based editing (pauses, fillers), Paper Edit | UI; `*_uxp` transcript ops; `plan_*` word-timeline ops + the cut route | `references/speech-text.md` |
| Captions, single-word captions | UI create/style; `build_caption_artifact` → `create_caption_track` | `references/speech-text.md` |
| Enhance Speech, Enhance Audio (stems), Auto Ducking, Remix | UI; `setup_ducking` writes level keyframes | `references/audio.md` |
| loudness, silence, beats, transients | `analyze_loudness`, `detect_silence`, `detect_beats` (FFmpeg on source files) | `references/audio.md` |
| Auto Reframe | `auto_reframe_sequence` | `references/timeline-automation.md` |
| Scene Edit Detection | `scene_edit_detection` | `references/timeline-automation.md` |
| Morph Cut, Color Match, Warp Stabilizer | transition/effect by script; analysis and match in Premiere/UI | `references/timeline-automation.md` |
| Search panel (Media Intelligence), AI Assistant (beta) | UI | `references/search-assistant.md` |
| jobs that combine several tools | — | `references/combos.md` |
| availability, credits, Premiere (Beta), handoff/interchange, export | — | `references/gotchas.md` |

## 5. UI-only steps

1. Do the scriptable part first: checkpoint, save, active sequence, selection, playhead (`set_playhead_position`), in/out, gaps on the timeline.
2. Steps that spend Adobe credits or send media or chat to Adobe's cloud (generative tools, AI Assistant, caption translation, Enhance Speech V2): ask the user first and state the cost from the feature's reference.
3. Computer use available → perform the click path from the reference; screenshot only the panel involved; never while `pr_*` writes run. Otherwise → send the user the exact click path in one message and wait.
4. Verify as in §2 step 4. Never report a UI step as done without readback.

## 6. Failures

- `isError` or `ok:false` → failed.
- Unavailable or "requires UXP" → name the prerequisite (UXP bridge, newer Premiere) and offer the supported alternative.
- "Success" but no visible change → re-read; some 26.x builds ignore certain edits silently.
