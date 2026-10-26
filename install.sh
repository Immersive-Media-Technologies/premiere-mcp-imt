#!/bin/bash
# PR-MCP-IMT — install on macOS.
#   ./install.sh               check → build → Premiere connector (asks) → live self-test → client configs (asks)
#   ./install.sh --yes         same, without questions
#   ./install.sh --no-config   check, build, connector and self-test only; print the config instead
# The Premiere side is a CEP extension (MCPBridgeCEP) copied into
# ~/Library/Application Support/Adobe/CEP/extensions; unsigned CEP extensions are enabled through
# PlayerDebugMode. scripts/uninstall-cep.sh removes it.
set -u
YES=0; NOCONF=0
for a in "$@"; do case "$a" in --yes|-y) YES=1;; --no-config) NOCONF=1;; esac; done
RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s  ok  %s%s\n' "$GRN" "$OFF" "$*"; }
warn() { printf '%s warn %s%s\n' "$YEL" "$OFF" "$*"; }
bad()  { printf '%s FAIL %s%s\n' "$RED" "$OFF" "$*"; FAIL=1; }
ask()  { [ "$YES" = "1" ] && return 0; printf '%s [y/N] ' "$1"; read -r r; [ "$r" = "y" ] || [ "$r" = "Y" ]; }
premiere_running() { pgrep -f "Adobe Premiere Pro" >/dev/null 2>&1; }

say ""; say "PR-MCP-IMT — environment check"; say "─────────────────────────────────────────────"
if [ "$(uname -s)" != "Darwin" ]; then bad "this script is for macOS (found: $(uname -s)); on Windows run install.ps1"; else ok "macOS $(sw_vers -productVersion)"; fi

PR_APP=""
for y in 2026 2025 2024; do
  d="/Applications/Adobe Premiere Pro $y/Adobe Premiere Pro $y.app"
  [ -d "$d" ] && { PR_APP="$d"; break; }
done
[ -n "$PR_APP" ] && ok "Premiere Pro: $PR_APP" || bad "Premiere Pro not found in /Applications (2024–2026 supported)"

# Node by absolute path: a GUI client (Claude Desktop, Cursor) does not see nvm's PATH.
NODE_BIN=""
for n in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$(command -v node 2>/dev/null)"; do
  [ -n "$n" ] && [ -x "$n" ] || continue
  "$n" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)' 2>/dev/null && { NODE_BIN="$n"; break; }
done
if [ -z "$NODE_BIN" ]; then
  bad "Node.js >= 20.19 not found (checked /opt/homebrew/bin, /usr/local/bin, /usr/bin, PATH)"
  say "${DIM}     install: brew install node   — or use the Claude Desktop extension (.mcpb), which needs no Node${OFF}"
else
  ok "Node $("$NODE_BIN" -v) — $NODE_BIN"
fi
command -v ffmpeg >/dev/null 2>&1 || [ -x /opt/homebrew/bin/ffmpeg ] || [ -x /usr/local/bin/ffmpeg ] \
  && ok "ffmpeg found (audio/video analysis operations)" \
  || warn "ffmpeg not found — analysis operations (loudness, silence, beats, scene changes) need it: brew install ffmpeg"
[ "$FAIL" = "1" ] && { say ""; say "${RED}Stopped.${OFF}"; exit 1; }

say ""; say "Build"; say "─────────────────────────────────────────────"
cd "$HERE" || exit 1
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1
else npm install --no-audit --no-fund >/dev/null 2>&1; fi
[ -d node_modules ] && ok "dependencies installed" || { bad "npm install failed"; exit 1; }
npm run build >/dev/null 2>&1
[ -f dist/index.js ] && ok "server built: dist/index.js" || { bad "build produced no dist/index.js (run npm run build to see why)"; exit 1; }

say ""; say "Premiere connector"; say "─────────────────────────────────────────────"
JUST_INSTALLED=0
if bash scripts/install-cep.sh --diagnose >/dev/null 2>&1; then
  ok "connector installed and unsigned CEP extensions enabled"
else
  warn "connector missing or CEP debug mode off"
  if ask "Install the Premiere connector (copy MCPBridgeCEP into your CEP extensions folder, enable PlayerDebugMode)?"; then
    if bash scripts/install-cep.sh --copy >/dev/null 2>&1; then ok "connector installed"; JUST_INSTALLED=1
    else bad "connector install failed — run: bash scripts/install-cep.sh --copy"; fi
  else
    warn "skipped — the agent can install it later (pr_install_connector) or run: bash scripts/install-cep.sh --copy"
  fi
fi

say ""; say "Live check against Premiere Pro"; say "─────────────────────────────────────────────"
if ! premiere_running; then
  warn "Premiere Pro is not running — skipping the live check (open it with a project and run ./install.sh again)"
elif [ "$JUST_INSTALLED" = "1" ]; then
  warn "the connector was just installed — quit Premiere Pro completely, reopen it, then run ./install.sh again"
else
  OUT="$("$NODE_BIN" "$HERE/tools/selftest.mjs" 2>/dev/null)"
  if printf '%s' "$OUT" | grep -q '"ok": *true'; then
    ok "Premiere answers — project: $(printf '%s' "$OUT" | sed -n 's/.*"project": *"\([^"]*\)".*/\1/p'), sequence: $(printf '%s' "$OUT" | sed -n 's/.*"sequence": *"\([^"]*\)".*/\1/p')"
  else
    bad "Premiere did not answer"; printf '%s\n' "$OUT" | head -16
    say "${DIM} • Close any open dialog in Premiere and try again.${OFF}"
    say "${DIM} • Quit Premiere completely and reopen it after installing the connector.${OFF}"
    say "${DIM} • Details: node dist/index.js --diagnose-cep${OFF}"
  fi
fi

SERVER_JSON="{
      \"command\": \"$NODE_BIN\",
      \"args\": [\"$HERE/dist/index.js\"]
    }"
say ""; say "Connect"; say "─────────────────────────────────────────────"
if [ "$NOCONF" = "1" ]; then
  say "Add to your client's MCP config:"; say ""; say "  \"mcpServers\": { \"premiere\": $SERVER_JSON }"; say ""
else
  # write_config <file> <label>: inserts/replaces mcpServers.premiere, keeps everything else, backs up first
  write_config() {
    f="$1"; label="$2"
    if ask "Add the server to $label ($f)?"; then
      mkdir -p "$(dirname "$f")"
      [ -f "$f" ] && cp "$f" "$f.bak-$(date +%Y%m%d-%H%M%S)"
      "$NODE_BIN" - "$f" "$NODE_BIN" "$HERE/dist/index.js" <<'NODE'
const fs = require('fs'); const [file, node, entry] = process.argv.slice(2);
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.premiere = { command: node, args: [entry] };
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
NODE
      ok "$label: mcpServers.premiere written (restart $label)"
    fi
  }
  write_config "$HOME/Library/Application Support/Claude/claude_desktop_config.json" "Claude Desktop"
  write_config "$HOME/.cursor/mcp.json" "Cursor"
  write_config "$HOME/.gemini/config/mcp_config.json" "Google Antigravity"
  say ""
  say "Other clients: \"mcpServers\": { \"premiere\": $SERVER_JSON }"
fi
say ""
say "${DIM}First session on a new machine: add \"env\": { \"PR_MCP_READONLY\": \"1\" } and work on a COPY of the${OFF}"
say "${DIM}project — the server edits the open project and Premiere has no scripted undo.${OFF}"
say ""
