// Live self-test: starts the server over stdio, calls pr_verify and prints a short verdict + the report.
// A separate file (not a line in install.sh) because it tells apart failures that look the same from
// outside: the server did not start, the Premiere connector does not answer, no project/sequence open.
//   node tools/selftest.mjs                      — this checkout's dist/index.js
//   node tools/selftest.mjs <path/to/index.js>   — another install (e.g. the server inside a .mcpb)
// Exit codes: 0 — connector answers (project/sequence state is printed, not required);
//             1 — server or connector failure.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(process.argv[2] ?? join(root, "dist", "index.js"));
let done = false;
let stderr = "";

const finish = (ok, payload) => {
  if (done) return;
  done = true;
  console.log(JSON.stringify({ ok, ...payload }, null, 2));
  try {
    srv?.kill();
  } catch {
    /* already gone */
  }
  process.exit(ok ? 0 : 1);
};

if (!existsSync(entry)) finish(false, { error: `server entry not found: ${entry} — run npm run build` });

const srv = spawn(process.execPath, [entry], {
  cwd: dirname(entry),
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, PR_MCP_FACADE: "1" },
});
srv.stdout.setEncoding("utf8");
srv.stderr.setEncoding("utf8");
srv.stderr.on("data", (d) => (stderr += d));
srv.stdin.on("error", () => {
  /* the close handler reports a dead server */
});
srv.on("error", (e) => finish(false, { error: `server did not start: ${e.message}` }));
srv.on("close", (code) =>
  finish(false, { error: `server exited (code ${code}) before answering`, stderr: stderr.slice(-2000) }),
);

let buf = "";
const pending = new Map();
srv.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      // responses only: a server-initiated request (ping …) also carries an id
      if (msg.id != null && !msg.method && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      /* not a JSON-RPC line */
    }
  }
});

let id = 0;
const send = (method, params) =>
  new Promise((res) => {
    const rid = ++id;
    pending.set(rid, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: rid, method, params }) + "\n");
  });

setTimeout(
  () => finish(false, { error: "timeout 60 s — the server did not answer", stderr: stderr.slice(-2000) }),
  60_000,
).unref();

const init = await send("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "selftest", version: "1" },
});
if (init.error) finish(false, { error: `initialize failed: ${init.error.message ?? JSON.stringify(init.error)}` });
srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const r = await send("tools/call", { name: "pr_verify", arguments: {} });
if (r.error) finish(false, { error: r.error.message ?? String(r.error), stderr: stderr.slice(-2000) });
const text = (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
if (r.result?.isError) finish(false, { error: text || "pr_verify failed", stderr: stderr.slice(-2000) });
let report = r.result?.structuredContent;
if (!report) {
  try {
    report = JSON.parse(text);
  } catch {
    report = { text };
  }
}
const data = report?.data ?? report;
const comp = Object.fromEntries((data?.components ?? []).map((c) => [c.id, c.state]));
const connector = comp.premiere_connector === "ready";
finish(connector, {
  connector: connector ? "answers" : "does not answer",
  project: comp.active_project ?? "unknown",
  sequence: comp.active_sequence ?? "unknown",
  overall: data?.overall ?? "unknown",
  repair: (data?.components ?? []).filter((c) => c.state !== "ready" && c.repair).map((c) => c.repair),
});
