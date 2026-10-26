# Security Policy

## Reporting a vulnerability

Do not open a public issue. Report it privately through a
[GitHub Security Advisory](https://github.com/Immersive-Media-Technologies/premiere-mcp-imt/security/advisories/new)
with a description, the impact, steps to reproduce and, if you have one, a suggested fix.

## What the server can do

- It runs ExtendScript inside Premiere Pro through a CEP extension and edits the open project.
  Connect only MCP clients you trust.
- Raw ExtendScript (`pr_execute_script`) is off unless `PR_MCP_ENABLE_SCRIPT` or an explicit
  `unsafe-script` capability turns it on; `PR_MCP_READONLY` limits the server to inspection and
  frame/file export.
- Script validation blocks `eval()`, `new Function()` and `System.callSystem()` in generated
  scripts; the raw-script path bypasses it by design.
- The file bridge writes command and response files to a per-user temp directory; keep its
  permissions private.
- The server sends no telemetry. Project content reaches the AI provider your client uses.
