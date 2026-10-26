# Generative AI: Generative Extend, Generative Media Tool, Firefly Boards

Availability and credits: `gotchas.md` §Availability, §Credits. Use Premiere ≥ 26.5.

## Generative Extend (GE)

Use when a clip lacks handles: hold a shot for a transition or a reaction, cover a J/L-cut, extend
room tone or ambience.

Click path: Tools panel → **Generative Extend** (same slot as the Generative Media Tool; long-press
to switch) → drag the clip's edit point outward → stripes while generating → the extension carries a
label in the timeline; right-click the label → regenerate.

Prepare by script: the clip has speed 1.0 (`pr_get_sequence`) and is not a multicam source
(`get_item_info`); trim unusable frames first (`trim_clip`); free the space beyond the edit point on
that track; `set_playhead_position` at the edit point. Afterwards: `pr_get_sequence` — the clip's edge
moves or a separate generated item appears next to it (not verified which; check both);
`pr_export_frame` on the last source frame and the first generated frame.

Limits — source: helpx GE overview (the user checked it; numbers partly via a third-party quote).
Adobe's marketing page says "both ends" and "keeps dialogue"; trust helpx.
- One end per extension (start or end). Up to 2 s video / 10 s audio per extension; source clip ≥ 2 s (video), ≥ 3 s (audio).
- 26.5 inputs: 360p–4K UHD, any aspect ratio (vertical, square, ultrawide, anamorphic), interlaced (extended as progressive), non-square pixels.
- Output: sources above 30 fps extend at 30 fps; always SDR 8-bit, also from HDR or high-bit-depth sources. iPhone HDR clips unsupported.
- Audio: ambience, room tone, effects only. Dialogue is muted in the extension; clips containing music are refused; mono/stereo only (no 5.1).
- Not supported: speed-changed clips, multicam source sequences.
- Generated media go to a scratch-disk location (the user's notes name it "Captured and Generated"; unverified). UI only: Project Settings › Scratch Disks → a fast drive; `set_project_scratch_disk` has no such type.
- Handoff of extended clips: `gotchas.md` §Handoff.

## Generative Media Tool (GMT)

Status: Generate Video and Generate Sound Effects released in 26.5. Premiere (Beta) 27.0 only:
Generate Music, Generate Soundscape, Sync to Video.

Click path: Tools panel → **Generative Media Tool** → drag a range on a video or audio track, or
double-click a gap → floating taskbar: prompt, model, reference frames, settings, credit estimate →
**Generate**. The range sets the duration and behaves like a clip (trim, move, snap); drawing it is a
UI step. New ranges can start while earlier generations run. Result: an ordinary clip with an AI badge
(sparkle); badge → pick a variation, or reopen prompt/settings/references to regenerate. Files: the
project's generation folder and a "Generation history" bin (one source: "Generated History"; location
configurable). The badge and its settings travel with the project.

Prepare by script: a gap or an empty track region of the exact length, markers (`add_marker`) on the
frames the user will aim at.

### Generate Video
- Models: Firefly Video Model + partner models, default **Veo 3.1**; reviews also show Kling 3.0, Runway Gen-4.5, Luma. Partner models are paid in Adobe credits (no partner account); availability varies by plan, region and account type (business plans: partner models pending).
- Reference frames: First Frame, Last Frame, Previous Frame, Next Frame (in a gap filled from the neighbouring clips), Reference Frames (model-dependent). Pick with the eyedropper from the Program Monitor, Source Monitor or Project panel.
- Veo 3.1 accepts Reference Frames only for 8 s, 16:9 generations; for First/Last Frame limits read the taskbar.
- Settings: resolution, aspect, fps, duration (seed on some models). Premiere chooses the closest supported settings. Adobe's rate table lists Firefly video up to 1080p24 → expect upscaling in a 4K sequence (inferred).
- Audio with the picture only on models that generate it (Veo 3.1).
- Prompt as a shot description: subject, action, camera move, lens, light, mood; for a gap, describe the motion between the two frames. Adobe's prompt guidance covers Firefly only.
- "Commercially safe" is Adobe's claim for Firefly; do not extend it to partner models.

### Generate Sound Effects
Range on an audio track → describe the sound → optional **Record a Guide** (voice, claps or mouth
sounds set timing and intensity) → Generate → 4 variations from the badge, each the range's length.
48 kHz. Maximum length undocumented. **Sync to Video** (next to Record a Guide) times the sound to the
action in the picture above the range.

### Generate Soundscape
No prompt. Analyses up to 15 s of picture above the range → 4 premixed tracks (2 ambience,
2 effects) × 4 variations = 16 clips. Sync is inconsistent — audit each track.

### Generate Music (build 22+)
Range on an audio track → Generate Music. Modes: text prompt (with enhance-prompt), **Video to
Prompt** (follows the action of the picture above the range), Loops; intro/outro structure option
(reviews). Tempo BPM or auto; 5 s – 5 min; 4 variations. Royalty-free with sync rights (TV, games,
film, ads).

## Cost (Adobe generative credits)
- GE, per generated second: 4K30 175 · 4K24 150 · 1080p30 125 · 1080p24 100 · 720p30 75 · 720p24 50. Whether source or sequence settings pick the tier is undocumented.
- Firefly video, per second: 1080p24 100 · 720p24 50 · 540p24 20. Partner models vary (one transition clip showed 200) — read the taskbar estimate.
- Sound effects: 10 per generation. Music: 20 per minute.

## Firefly Boards → Premiere (26.3)
- Select assets on the board **in story order** → send them to Premiere (entry point unverified) → a sequence is built in selection order. Images and videos transfer (no colour shift); text and 3D objects do not.
- Opens only in the release Premiere app. For Premiere (Beta): open in release, then import there.
- Boards clips have fixed lengths → lengthen with GE.
- Boards partner-model limits differ from Premiere's GMT (e.g. Kling 3.0: ≤ 5 shots, ≤ 15 s per shot); Boards asks to confirm use of a non-Adobe model.

## Content Credentials
Added at export to anything containing AI-generated media (Music: to every generation); Adobe Content
Authenticity holds the preferences. Publishing platforms may strip them.

Sources: helpx.adobe.com/premiere/desktop/edit-projects/edit-with-generative-ai/ — generative-extend-overview,
generative-media-tool-overview, generate-media-with-generative-media-tool, generative-media-tool-faq,
generate-music-overview; …/organize-media/import-files/import-media-from-firefly-boards;
helpx.adobe.com/firefly/using/generative-credits-faq; …/firefly-boards/partner-models-to-generate-videos.
