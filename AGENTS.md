# AGENTS.md

Instructions for coding agents working **on this repository**. (Agents that *use* the server to
edit in Premiere read `skills/pr/SKILL.md` — served at runtime by the `pr_skill` tool.)

## What this is

Premiere-MCP-IMT — a local stdio MCP server that controls a running Adobe Premiere Pro, by Immersive
Media Technologies; a fork of [premiere-pro-mcp](https://github.com/leancoderkavy/premiere-pro-mcp)
(MIT). Production path: Node.js server ↔ CEP extension `MCPBridgeCEP` inside Premiere through
file-based IPC (`.jsx` command files, `.json` responses). The UXP bridge (`PREMIERE_UXP_TOKEN`,
`uxp-plugin/`) is optional; a failed UXP mutation is never retried through CEP or QE.

## Layout

| path | what |
|---|---|
| `src/tools/*.ts` | the ~380 operations (upstream), grouped into categories in `src/server.ts` |
| `src/product/` | IMT layer: `facade.ts` (nine tools over the catalog), `skill.ts` (`pr_skill`), `connector.ts` (`pr_install_connector`), `instructions.ts`, `envflag.ts`, `pathfix.ts` |
| `src/bridge/` | CEP file bridge, UXP WebSocket bridge, ExtendScript builder (`__compIs` / `__propIs`: localized matchName lookup) |
| `src/security/capabilities.ts` | capability profiles (inspect, edit, export, filesystem, unsafe-script) |
| `skills/pr/` | the agent skill: `SKILL.md` router + `references/*.md` |
| `cep-plugin/`, `after-effects-cep-plugin/`, `uxp-plugin/` | Premiere connector, After Effects connector, UXP plugin |
| `mcpb/`, `scripts/build-mcpb.mjs` | Claude Desktop extension |
| `install.sh`, `install.ps1`, `tools/` | installers, live self-test, ChatGPT gateway |

## Commands

| task | command |
|---|---|
| build | `npm ci && npm run build` |
| tests (offline, no Premiere needed) | `npm test` |
| full check (lint, build, tests) | `npm run check`; package contents: `npm run pack:check` |
| Claude Desktop extension | `npm run build:mcpb` → `release/premiere-mcp-imt-<version>.mcpb` |
| live check against a running Premiere | `npm run selftest` |

## Rules

- Facade is the default. A new user-facing capability is an operation in the catalog (reached through
  `pr_do`), not a new top-level tool, unless it cannot work through `pr_do` (like `pr_skill`).
- Writes verify by readback where Premiere allows it; report "unverified" otherwise. Premiere 26 has
  no scripted undo — never claim one.
- Localized Premiere: find components and properties with `__compIs` / `__propIs`, never by English
  `displayName`.
- No telemetry, no network calls from the server except the explicit update check.
- The skill: SKILL.md stays a router; facts live in exactly one reference; every operation name it
  mentions must exist (tests/product.test.ts checks the reference links).
- Versions: `package.json`, `cep-plugin/CSXS/manifest.xml`, `cep-plugin/index.html`,
  `cep-plugin/updater.cjs`, `after-effects-cep-plugin/CSXS/manifest.xml`, `uxp-plugin/manifest.json`
  move together; `npm test` checks them. Add a `CHANGELOG.md` section for every release.
