# Audio AI: Enhance Speech, Enhance Audio (stems), ducking, Remix, analysis

## Enhance Speech (released; local, free, unlimited)
Click path: Essential Sound › tag the clip **Dialogue** › **Enhance** › Mix Amount.
- Not for music, effects, singing, whispers, overlapping speakers, severely degraded audio.
- User reports: greyed out on 96 kHz files (use a 48 kHz version); "underwater" sound above ≈ 0.3 mix — start low and compare; weaker on Slavic languages.

## Enhance Audio — stem separation (Premiere Beta 27.0, build 36+)
Click path: Properties panel › Audio (also clip right-click and the Clip menu; not in Essential
Sound). Model per clip, or a default in AI Model Preferences.
- Stems: dialogue, music, ambience, effects, reverb. Dialogue: Volume, Enhancement, Reverb; other stems: volume and mute.
- Separation runs on-device. Enhance Speech V1 local and free; V2 in Adobe's cloud, 2 credits per minute → V1 while cutting, V2 on locked clips.
- Applied in place with 5 s handles; trims inside the handles do not reprocess. **Split to Clips** puts the stems on the timeline as separate clips (then scriptable: `adjust_audio_levels`, `remove_from_timeline`).
- Known issues: can be disabled, not removed; no slider reset; vocals leak into the music stem — listen before delivery.
- "Separate Crosstalk" is mentioned by Adobe in interviews; UI unverified.

## Ducking
- UI Auto Ducking: select the music/ambience clips › Essential Sound › Music › **Ducking** (Sensitivity, Duck Amount, Fade Duration, Fade Position) › **Generate Keyframes**. Re-running replaces the keyframes. Reliability fixed in 26.3.
- Script: `setup_ducking {node_id, base_db, ducking_windows:[{start_seconds, end_seconds, ducked_db}], fade_seconds}` — one call per music clip; windows non-overlapping, ≤ 32, relative to that clip's start (sequence time − music clip.start). Windows from the dialogue clips' ranges (`pr_get_sequence`) or from `detect_silence` keep segments mapped to sequence time.

## Remix (UI)
Remix Tool (click-hold the Ripple Edit tool) → drag the music clip's end; options: Target Duration,
Segments, Variations. Re-composes the music to the length.

## Analysis operations (FFmpeg on source files; never change Premiere)
Need `ffmpeg` on the machine (the server adds the Homebrew folders to PATH on macOS). Results in
source seconds.

| operation | gives |
|---|---|
| `analyze_loudness` | integrated LUFS, loudness range, true peak |
| `normalize_loudness_file` | a new normalized file, remeasured (input never overwritten) |
| `detect_silence` | silences + keep segments (`noise_threshold_db`, `min_duration_seconds`) |
| `plan_silence_review_markers` | a marker plan for the silences of one 1× placement → apply with `add_markers_batch` |
| `detect_beats` | steady beat grid → `plan_beat_montage` |
| `detect_audio_transients` | edit-point candidates (claps, hits, sync beeps) |

Sources: helpx.adobe.com/premiere/desktop/add-audio-effects/adjust-volume-and-levels/enhance-speech;
Adobe Community «Now in beta: Enhance Audio in Premiere», «Now released: Enhance Speech»;
helpx «automatic audio ducking».
