# Search panel (Media Intelligence) and AI Assistant (beta)

## Search panel
Open: magnifier at the top right of the main window (not Find, Cmd+F).
- Natural-language query over visuals, spoken words (transcripts), sounds and metadata. Filter: Everything / Audio / Video / Transcription / Metadata; scope: Source, Sequence or both. A result opens in the Source Monitor.
- **Search Similar Frames:** right-click a frame in the Source or Program Monitor, or a visual result; also a Program Monitor toolbar button.
- Audio search by description ("swoosh", "lightning crack thunder"); covers all open projects. Descriptive multi-word queries work best.
- 26.3: markers searchable by colour and name.
- Analysis runs on-device (no upload, no training on the media); it starts on import, project open and when the panel opens → a large project needs time before results are complete. English queries (stated for the 2025 beta; unverified for 26.x).
- Weak at clapperboards/slates and sync beeps → `detect_audio_transients` for beeps, markers for slates.
- After the user (or computer use) finds a shot: `find_project_item_by_name` / `search_project_items` give the node id for scripted work.
- Scripted search over captured evidence instead: `manage_project_context` → `search_project_context`.

## AI Assistant (public beta, Premiere Beta app only)
Open: Window › Assistant. Prompt bar; **+** starts a new chat; tabs switch chats.
- Does: bins, renaming, colour labels, transcripts, slate detection → markers, stringouts as an editable sequence, multicam sync.
- Does not: versioning, cut-downs, working from scripts or other documents.
- Permissions: keep **Always ask permission**; never Auto approve.
- Expand **Reasoning** to see its plan and the tools/models it used.
- Undo: each action goes into History; **Undo** reverts its whole last turn. Edits made while it runs interleave with its steps in History → raise the undo (History) limit first and do not edit concurrently.
- Credits: beta credits separate from Creative Cloud credits. Sources conflict: daily reset at midnight GMT (Adobe announcement) vs a rolling 7-day task limit (staff reply). One user spent them in ~20 min on a 17-min project.
- Chat content goes to Adobe's cloud; optimised for English; Adobe advises a duplicate project and no client work.
- With Premiere-MCP-IMT on the same project: never run both at once; after an Assistant turn re-read with `pr_get_sequence` before scripting. Delegate to it what it does well (slates, multicam sync, bin organisation) when the user has the beta.

Sources: helpx.adobe.com/premiere/desktop/organize-media/file-organization/media-intelligence-and-search-panel;
Adobe Community «Search panel updates: audio search and search similar frames», «Meet your new
assistant editor: AI Assistant in Premiere Pro is now in public beta»; provideocoalition.com «premiere-ai-assistant».
