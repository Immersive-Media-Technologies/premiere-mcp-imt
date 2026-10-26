<p align="center"><img src="assets/banner.jpg" alt="PR-MCP-IMT + SKILLS — Premiere Pro for AI agents" width="1280"></p>

# PR-MCP-IMT + SKILLS — Premiere Pro for AI agents

Let an AI assistant (Claude Desktop, Cursor, ChatGPT, Google Antigravity or any MCP client) work
inside your running **Adobe Premiere Pro**: read the project and its sequences, cut, trim, move and
ripple clips, apply effects, transitions and keyframes, add markers and captions, reframe, check
frames and export — from plain language.

Two parts, made to work together:

- **The MCP server** — about 380 Premiere operations behind nine tools; writes are verified by
  reading Premiere back; works on a non-English Premiere; no telemetry.
- **The skill** (`skills/pr`, also served by the `pr_skill` tool, so it works in any client) — how
  to drive Premiere safely, where scripting ends, and how to use **Premiere's own AI tools**:
  Generative Extend, the Generative Media Tool (video, sound effects, music), Object Mask, Speech to
  Text and Paper Edit, captions, Enhance Speech and stem separation, Search, the AI Assistant, Auto
  Reframe, Scene Edit Detection, Morph Cut — plus recipes that combine them and the gotchas.

By **[Immersive Media Technologies](https://github.com/Immersive-Media-Technologies)** — the Premiere
layer of our Deep Artisan agent system, released for other agent builders.

**macOS and Windows · Premiere Pro 2024–2026 — verified live on macOS (26.5.1, Russian UI) and on
Windows 11 ARM (26.5.2, English UI, Claude Desktop from the Microsoft Store) · Node.js 20.19+ (none
needed with the Claude Desktop extension).**

> [!CAUTION]
> This edits real Premiere projects, and Premiere has **no scripted undo** — work on a copy. Project
> content (names, transcripts, markers, frames) goes to the AI service you use. Premiere's
> generative tools spend your Adobe credits; the agent asks before starting one. Raw ExtendScript is
> off unless you turn it on.

## What you can ask for

- "List every clip shorter than 12 frames and every gap in the active sequence."
- "Tighten the pauses in this interview to a third of a second and put a Morph Cut on the jump
  cuts where the camera is locked off." _(skill)_
- "Make 9:16 and 1:1 versions of this edit and check the titles stay out of the TikTok UI zones."
- "Blur the face of the man on the left for the whole shot." _(skill: you click the subject with
  Object Mask, the agent does the rest)_
- "The music in this interview was recorded on location — get rid of it and score it again under
  the dialogue." _(skill)_
- "Mark every beat of this track and lay the selects to it, two beats per shot."

The agent combines the operations itself and checks the sequence between steps; the skill tells it
which Premiere AI tool fits the job, what it costs and where it breaks.

## Install

You need Premiere Pro running on this computer and the **connector** — a small CEP extension
inside Premiere that the server talks to. The agent installs it for you on first use
(`pr_install_connector`, it asks first; then quit and reopen Premiere), or the installer below does.

| Client | How |
|---|---|
| <img src="https://www.google.com/s2/favicons?domain=claude.ai&sz=32" width="16" height="16" alt=""> **Claude Desktop** | download [`premiere-mcp-imt.mcpb`](https://github.com/Immersive-Media-Technologies/premiere-mcp-imt/releases/latest/download/premiere-mcp-imt.mcpb), double-click, **Install** (Windows: drag it onto Settings → Extensions). No Node needed. |
| <img src="https://www.google.com/s2/favicons?domain=cursor.com&sz=32" width="16" height="16" alt=""> **Cursor** | <a href="https://cursor.com/en/install-mcp?name=premiere&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBpbW1lcnNpdmUtbWVkaWEtdGVjaG5vbG9naWVzL3ByZW1pZXJlLW1jcC1pbXQiXX0="><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" height="20"></a> |
| <img src="https://www.google.com/s2/favicons?domain=antigravity.google&sz=32" width="16" height="16" alt=""> **Google Antigravity** | Settings → Customizations → Installed MCP Servers → **View raw config** → add the snippet below. |
| <img src="https://www.google.com/s2/favicons?domain=chatgpt.com&sz=32" width="16" height="16" alt=""> **ChatGPT** (remote servers only) | on the Premiere machine: `npx -p @immersive-media-technologies/premiere-mcp-imt premiere-mcp-imt-chatgpt` — it starts the server behind a tunnel and prints the URL to paste into ChatGPT. |
| **Any MCP client** | the snippet below in its `mcpServers`. |

```json
{
  "mcpServers": {
    "premiere": {
      "command": "npx",
      "args": ["-y", "@immersive-media-technologies/premiere-mcp-imt"]
    }
  }
}
```

**From source, with a live self-test** (the route we use):

```bash
git clone https://github.com/Immersive-Media-Technologies/premiere-mcp-imt.git
cd premiere-mcp-imt && ./install.sh        # Windows: .\install.ps1
```

The installer checks Premiere, Node and FFmpeg, builds, installs the connector (asks first), asks the
running Premiere whether the connector answers, and — after asking — writes the entry into Claude
Desktop's, Cursor's and Antigravity's configs, backing them up.

<details>
<summary>If something does not connect</summary>

- `pr_verify` says the connector does not answer: quit Premiere **completely** after the connector
  was installed and open it again; close any open Premiere dialog (a modal dialog blocks scripting).
  `premiere-mcp-imt --diagnose-cep` checks the files, the debug flags and Premiere's signature log.
- The connector is unsigned: CEP must allow unsigned extensions (`PlayerDebugMode` = `1` for CSXS
  9–14; on Windows a String (`REG_SZ`) value under `HKCU\Software\Adobe\CSXS.<n>`). The installers set it.
- `spawn npx ENOENT` on macOS: GUI apps do not see your shell `PATH` — put the absolute path of a
  Node from Homebrew or nodejs.org in place of `npx` (nvm's Node is invisible to them).
- Loudness, silence (`detect_silence`), beat and scene-change analysis need FFmpeg
  (`brew install ffmpeg`, `winget install Gyan.FFmpeg`).
- Windows, Claude Desktop from the Microsoft Store: the Store app's registry writes are sandboxed. If
  Premiere does not load the connector after `pr_install_connector`, run
  `powershell -ExecutionPolicy Bypass -File scripts\install-cep.ps1` once from a normal PowerShell in a
  source checkout (or use `install.ps1`).
- `premiere-mcp-imt --doctor` checks the local install without reading a project.
</details>

## How it stays safe

| | |
|---|---|
| **Verified writes** | edits read Premiere back and report `verified` only when the readback matches; anything else is reported as unconfirmed. |
| **Checkpoints instead of undo** | Premiere has no scripted undo. `create_sequence_checkpoint` clones the sequence before a risky edit; `diff_sequence_snapshots` shows exactly what changed (added, removed, moved, trimmed clips with frame deltas). |
| **Plan → preview → apply** | `plan_*` operations only compute; compound edits apply only with the confirmation token of their preview, unchanged. |
| **Read-only mode** | `PR_MCP_READONLY=true` — inspection and exports only; the project cannot change. |
| **No raw scripting by default** | `pr_execute_script` exists only with `PR_MCP_ENABLE_SCRIPT=true`. |
| **No telemetry** | the server sends nothing anywhere. |

## Tools

| Tool | Purpose |
|---|---|
| `pr_verify` | connector, open project and active sequence — the first call |
| `pr_get_sequence` | tracks and clips with their `node_id`, times and speed |
| `pr_catalog` / `pr_do` / `pr_batch` | discover the ~380 operations (43 categories) and run one or several |
| `pr_export_frame` | a frame of the sequence as PNG — the agent's eye |
| `pr_save_project` | save |
| `pr_install_connector` | check / install the connector inside Premiere |
| `pr_skill` | the agent skill: the router and its references |
| `pr_execute_script` | raw ExtendScript — only when enabled |

`PR_MCP_FACADE=0` lists every operation as its own tool instead (about 150K tokens of definitions;
the nine tools cost about 1.5K).

| Variable | Default | Meaning |
|---|---|---|
| `PR_MCP_READONLY` | off | `true` → inspection and exports only |
| `PR_MCP_ENABLE_SCRIPT` | off | `true` → `pr_execute_script` (arbitrary ExtendScript) |
| `PR_MCP_FACADE` | on | `0` → every operation as a separate tool |
| `PREMIERE_MCP_CAPABILITIES` | — | explicit profile, e.g. `inspect,edit,export,filesystem`; wins over the switches |
| `PREMIERE_TEMP_DIR` | OS temp | the connector's file mailbox |
| `PREMIERE_UXP_TOKEN` | — | enables the optional UXP bridge (with the UXP plugin in Premiere) and its `*_uxp` operations |

## The skill

`skills/pr/SKILL.md` is a short **router** the agent reads first (`pr_skill` with no arguments); it
points to the one reference the task needs (`pr_skill {doc}`):

| | |
|---|---|
| `SKILL.md` | the tools, the order of work (state → checkpoint → operate → verify by values, then by frame), addressing (node ids, source vs sequence time, selection-driven operations, localized Premiere) and a table of **what scripts cannot do in Premiere** with the reference for each. |
| `references/generative.md` | Generative Extend, the Generative Media Tool (video with first/last/reference frames, sound effects with a voice guide, soundscape, music), Firefly Boards → sequence, partner models, credits per second. |
| `references/masking.md` | Object Mask, why a new mask "does nothing", Clip vs Frame keyframes, Sharpness / Expansion, where mask data lives and how it goes missing. |
| `references/speech-text.md` | Speech to Text, text-based editing of pauses and fillers, Paper Edit, single-word captions, and the server's word-timeline planners (fillers, pauses, retakes, bleeps, captions). |
| `references/audio.md` | Enhance Speech, stem separation (beta), ducking by UI and by keyframes, Remix, FFmpeg analysis. |
| `references/timeline-automation.md` | Auto Reframe, Scene Edit Detection, Morph Cut (and why it exports as a dissolve), Color Match, Warp Stabilizer. |
| `references/search-assistant.md` | the Search panel (Media Intelligence, similar frames, sound search) and the AI Assistant beta next to an agent. |
| `references/combos.md` | eleven recipes that combine tools: a generated shot between two clips, interview cleanup, a tracked face blur, storyboard to sequence, removing location music, social versions, silence and beat cutting. |
| `references/gotchas.md` | availability by region and licence, credits, beta vs release, handoff to colour and sound, export, scripting limits that look like bugs. |

Clients with their own skill support can load the folder directly (e.g. copy `skills/pr` into
`~/.claude/skills/`).

## Why this one

Several Premiere MCP servers exist; they differ in what the model sees, what it knows and what it
sends home. As of 2026-10-26:

<table>
<tr>
<th width="120"></th>
<th width="150">PR-MCP-IMT</th>
<th><a href="https://github.com/leancoderkavy/premiere-pro-mcp">premiere-<br>pro-mcp</a><br>(upstream)</th>
<th><a href="https://github.com/ayushozha/AdobePremiereProMCP">AdobePremiere<br>ProMCP</a></th>
<th><a href="https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP">Adobe_Premiere<br>_Pro_MCP</a></th>
<th><a href="https://github.com/sfkislev/flue">flue</a></th>
</tr>
<tr><td>Tools the model sees by default</td><td>9, over ~380 operations</td><td>the whole catalog (~440 tools)</td><td>74 (profile <code>standard</code>) of ~1,060</td><td>5, over 283 operations</td><td>none — the agent pipes ExtendScript</td></tr>
<tr><td>Knowledge of Premiere's AI tools</td><td>skill with 8 references + recipes</td><td>2 skills (editing, development)</td><td>7 workflow skills</td><td>1 skill</td><td>1 skill (scripting)</td></tr>
<tr><td>Non-English Premiere</td><td>matchName lookup, verified on Russian</td><td>English and es-ES measured</td><td>not stated</td><td>not stated</td><td>not stated</td></tr>
<tr><td>Telemetry</td><td>none</td><td>PostHog, off unless a key is set</td><td>none found</td><td>on by default (opt-out)</td><td>none mentioned</td></tr>
<tr><td>Connector install</td><td>by the agent, with consent; installers with a live self-test</td><td>CLI flag</td><td>build from source (Go, Rust, Python)</td><td>CLI flag</td><td><code>pip</code> + setup</td></tr>
<tr><td>Clients</td><td>Claude Desktop (.mcpb), Cursor, Antigravity, ChatGPT gateway, any MCP client</td><td>npm, .mcpb, Codex / Claude Code plugins</td><td>build from source</td><td>npm, plugins, .mcpb</td><td>CLI + skill</td></tr>
<tr><td>License</td><td>IMT Non-Commercial</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td></tr>
</table>

What we changed in the upstream code, besides the skill and the packaging: component and property
lookup by matchName (on a Russian Premiere every opacity, motion, keyframe and volume operation of
upstream failed), `split_clip` that cuts the clip you name (upstream cut track 0), no telemetry, stdio
only, and a compact tool surface.

## Releases

Each version is described on the
[**Releases**](https://github.com/Immersive-Media-Technologies/premiere-mcp-imt/releases) page; every
change is in [`CHANGELOG.md`](CHANGELOG.md).

- [v0.1.0](https://github.com/Immersive-Media-Technologies/premiere-mcp-imt/releases/tag/v0.1.0) · 2026-10-26 —
  first public release: the Premiere agent skill, nine-tool surface, `pr_skill`, connector install by
  the agent, Claude Desktop extension, installers with a live self-test, ChatGPT gateway.

`npm test` runs offline — no Premiere needed.

## License

**[IMT Non-Commercial License](LICENSE)** — © Immersive Media Technologies.

- **Non-commercial use only.** Selling this software, offering it as or inside a paid product or
  service, or using it in commercial client work requires a separate written license.
- **Attribution is mandatory.** Every use, copy, fork or derived product must credit the creator,
  visibly to its users: `PR-MCP-IMT by Immersive Media Technologies — https://github.com/Immersive-Media-Technologies`.
- No warranty.

Full terms: [`LICENSE`](LICENSE). Third-party notices (upstream MIT code):
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). Adobe, Premiere Pro and Firefly are trademarks of
Adobe Inc.; this project is not affiliated with or endorsed by Adobe.
