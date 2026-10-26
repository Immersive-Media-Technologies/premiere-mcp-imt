# Cross-cutting gotchas

Feature-specific limits are in each feature's reference; this file holds what applies across them.

## Availability
- Firefly is not offered in **Russia, Belarus and China** — documented for Generative Extend; assume the same for every Firefly generation (Generative Media Tool, Music). K-12 / education accounts may have limited or no access; some enterprise licences (CCE v3) have Firefly services disabled.
- Check before planning generative work: ask the user (country, plan), or `get_advanced_feature_support {generative_ai_entitled, network_available}`. Unavailable → say so at the start and plan non-generative routes (cutaways, `freeze_frame`, re-editing).

## Credits
- Generative credits are shared across Adobe apps; balance: Premiere's profile drop-down. Rates and formulas are in each feature's reference (per second, per generation, per minute); partner models: read the taskbar estimate.

## Premiere (Beta) vs release
- Features marked beta exist only in the Premiere (Beta) app (27.0). Work on a copy of the project there; do not hand a Beta-saved project to a release-only machine.
- The connector is verified with the release app. Premiere (Beta) reads the same CEP extensions folder (whether it loads the connector is unverified) — never run both apps at once while the server works: both would answer the same mailbox.
- helpx pages lag the app (the Generative Media Tool was still labelled beta after release). Trust the app's UI.

## Handoff and interchange
- Generative Extend clips may not transfer reliably through XML / AAF / EDL or Premiere Productions (helpx, per the user's notes); Generative Media Tool clips are unknown — treat them the same. Before turnover to colour or sound: render-and-replace, or export the generated clips as media and relink.
- Generated media (generative.md) and mask data (masking.md) live outside the .prproj; copy them with it.
- Scripted interchange: `export_as_fcp_xml`, `export_sequence_edl` (CMX 3600 from readback), `export_omf`; AAF only through the UXP bridge (`export_aaf_uxp`).

## Export
- 26.5 **Match Source** matches audio channels and sample rate, auto-downmixes, and warns when the format cannot carry the source layout (e.g. 5.1) instead of silently going stereo — read the warning, pick a format that carries the layout. Scripted exports: `verify_delivery_conformance {output_path, audio_channels, audio_sample_rate_hz}`.
- `export_sequence` hands off to Adobe Media Encoder; queue acceptance is not a finished render → verify the output file.

## Scripting limits that look like bugs
- No clip-speed API: speed operations report Unavailable.
- QE `rippleDelete` and the DOM ripple flag do not work on 26.x; `ripple_delete` ripples explicitly and verifies.

Sources: helpx.adobe.com/premiere/desktop/edit-projects/edit-with-generative-ai/generative-extend-overview
(availability), …/whats-new/release-notes, …/whats-new/beta-features; Adobe Community «What's new in
Adobe Premiere 26.5»; developer.adobe.com/premiere-pro/uxp/changelog (what UXP can script).
