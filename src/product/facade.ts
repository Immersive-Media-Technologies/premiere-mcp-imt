// FACADE over the upstream tool catalog.
//
// Upstream advertises ~380 tools; their definitions travel to the model on EVERY turn
// (~150K tokens of context). Like the other IMT servers (AfterEffects-MCP-IMT: ae_catalog + ae_do,
// Photoshop-MCP-IMT: ps_catalog + ps_do), with
// PR_MCP_FACADE=1 the client sees only:
//   pr_catalog(category?)          — operations by category / with parameters
//   pr_do(operation, args)         — any upstream operation by name
//   pr_batch(ops[], stopOnError)   — several operations in order
//   pr_verify                      — read-only connection check
//   pr_get_sequence                — active sequence structure (tracks, clips, node ids)
//   pr_save_project
//   pr_export_frame(path, time)    — PNG of a frame (the «Materials» tile)
//   pr_execute_script(script)      — raw ExtendScript (needs the unsafe-script capability)
//   pr_install_connector(action)   — status / install of the CEP connector inside Premiere
//   pr_skill(doc)                  — the Premiere agent skill (skills/pr): router + references
// Every upstream tool stays in the catalog: pr_do runs them through the same guarded
// handler, so upstream behaviour, capability checks and errors are unchanged.
import type { CallToolResult } from "@modelcontextprotocol/server";
import { envFlag } from "./envflag.js";
import { connectorTool } from "./connector.js";
import { skillTool } from "./skill.js";

export interface FacadeToolDef {
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>;
}

/** The facade is the default; `PR_MCP_FACADE=0` (or `false`) exposes the full upstream catalog. */
export function facadeEnabled(): boolean {
  return envFlag(process.env.PR_MCP_FACADE, true);
}

/** tool name → category (module), filled by server.ts while collecting modules. */
export const TOOL_CATEGORY = new Map<string, string>();

export function categorize<T extends Record<string, unknown>>(category: string, tools: T): T {
  for (const name of Object.keys(tools)) TOOL_CATEGORY.set(name, category);
  return tools;
}

/** First paragraph of an upstream description, capped (28.09: 160 → 400 — the
 * 160-char cut dropped the contract of 129/381 operations). */
function firstSentence(desc: string | undefined): string {
  const d = (desc || "").split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, " ").trim();
  return d.length > 400 ? d.slice(0, 397) + "…" : d;
}

/**
 * pr_execute_script → execute_extendscript. Upstream wants `code` that ends with
 * `return __result(...)` / `return __error(...)`; the facade advertises «the value
 * of the last expression comes back as JSON», so a script without those markers
 * is evaluated as an expression list (ES3 `eval` returns the last statement's
 * value) and wrapped for the bridge. 28.09: before this the facade passed
 * `{script}` where upstream read `args.code` — every call ran an empty script.
 */
export function mapExecuteScriptArgs(a: Record<string, unknown>): Record<string, unknown> {
  const raw = typeof a.script === "string" ? a.script : typeof a.code === "string" ? a.code : "";
  const usesContract = /__result\s*\(|__error\s*\(/.test(raw);
  const code = usesContract
    ? raw
    : `var __v = eval(${JSON.stringify(raw)});\n` +
      `return __result({ value: (__v === undefined ? null : __v), type: typeof __v });`;
  const out: Record<string, unknown> = { code };
  if (typeof a.timeout_ms === "number") out.timeout_ms = a.timeout_ms;
  return out;
}

function text(t: string, isError = false): CallToolResult {
  return isError
    ? { content: [{ type: "text", text: t }], isError: true }
    : { content: [{ type: "text", text: t }] };
}

/** Full signature of an operation (catalog by category). */
function opDetail(name: string, t: FacadeToolDef): string {
  const props = (t.parameters.properties ?? {}) as Record<
    string,
    { type?: string; description?: string; enum?: unknown[]; default?: unknown }
  >;
  const req = new Set((t.parameters.required as string[] | undefined) ?? []);
  const lines = [`- ${name}: ${firstSentence(t.description)}`];
  for (const [k, v] of Object.entries(props)) {
    const typ = v.enum ? v.enum.map(String).join(" | ") : v.type ?? "any";
    const def = v.default !== undefined ? ` (default ${JSON.stringify(v.default)})` : "";
    lines.push(`    ${k}${req.has(k) ? "" : "?"}: ${typ}${def}${v.description ? " — " + v.description : ""}`);
  }
  return lines.join("\n");
}

export interface FacadeSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

/**
 * @param tools     the full permitted catalog (name → def), handlers already guarded
 * @param invoke    runs one catalog tool and formats the MCP result exactly as the
 *                  per-tool registration would (structuredContent, image blocks, isError)
 */
export function buildFacade(
  tools: Record<string, FacadeToolDef>,
  invoke: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>,
): FacadeSpec[] {
  const catOf = (name: string): string => TOOL_CATEGORY.get(name) ?? "other";
  const names = (): string[] => Object.keys(tools).sort();

  const run = async (op: string, args: Record<string, unknown>): Promise<CallToolResult> => {
    const name = String(op || "").trim();
    if (!tools[name]) {
      const stem = name.split("_")[0];
      const near = names().filter((n) => stem && n.includes(stem)).slice(0, 8);
      return text(
        `unknown operation '${name}'. Use pr_catalog to list operations.` +
          (near.length ? ` Similar: ${near.join(", ")}` : ""),
        true,
      );
    }
    return invoke(name, args ?? {});
  };

  const direct = (name: string, description: string, parameters: Record<string, unknown>, map?: (a: Record<string, unknown>) => Record<string, unknown>): FacadeSpec => ({
    name,
    description,
    parameters,
    run: (a) => run(parameters._op as string, map ? map(a) : a),
  });

  return [
    {
      name: "pr_catalog",
      description:
        "List Premiere Pro operations available through pr_do. Without `category`: categories with counts and operation names. " +
        "With `category`: every operation of that category with its parameters. Call it before using an operation you have not used in this session. " +
        "Clips are addressed by node_id from pr_get_sequence.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: [...new Set([...TOOL_CATEGORY.values()])].sort().join(" | "),
          },
        },
      },
      run: async (args: Record<string, unknown>) => {
        const cat = typeof args.category === "string" ? args.category.trim().toLowerCase() : "";
        if (cat) {
          const ops = names().filter((n) => catOf(n) === cat);
          if (ops.length === 0) {
            return text(`no such category '${cat}'. Categories: ${[...new Set(names().map(catOf))].sort().join(", ")}`, true);
          }
          return text([`Category ${cat} (${ops.length}):`, ...ops.map((n) => opDetail(n, tools[n]))].join("\n"));
        }
        const groups = new Map<string, string[]>();
        for (const n of names()) {
          const c = catOf(n);
          if (!groups.has(c)) groups.set(c, []);
          groups.get(c)!.push(n);
        }
        return text([...groups.entries()].sort().map(([c, ns]) => `${c} (${ns.length}): ${ns.join(", ")}`).join("\n"));
      },
    },
    {
      name: "pr_do",
      description:
        'Run one Premiere Pro operation by name (see pr_catalog), e.g. {"operation":"add_marker","args":{"time_seconds":1.5,"name":"Intro"}}. ' +
        "Returns the operation result JSON. Writes are verified by readback where Premiere allows it; there is no scripting undo in Premiere 26 — " +
        "ask the user to use Edit > Undo if a change must be reverted. Prefer this over writing ExtendScript.",
      parameters: {
        type: "object",
        properties: {
          operation: { type: "string", description: "operation name from pr_catalog" },
          args: { type: "object", description: "operation parameters", additionalProperties: true },
        },
        required: ["operation"],
      },
      run: (args: Record<string, unknown>) => run(String(args.operation ?? ""), (args.args as Record<string, unknown>) ?? {}),
    },
    {
      name: "pr_batch",
      description:
        "Run several operations in order. Each op: {operation, args}. Stops at the first error when stopOnError (default true). Returns one result per op.",
      parameters: {
        type: "object",
        properties: {
          ops: {
            type: "array",
            items: {
              type: "object",
              properties: { operation: { type: "string" }, args: { type: "object", additionalProperties: true } },
              required: ["operation"],
            },
          },
          stopOnError: { type: "boolean", default: true },
        },
        required: ["ops"],
      },
      run: async (args: Record<string, unknown>) => {
        const ops = Array.isArray(args.ops) ? (args.ops as { operation: string; args?: Record<string, unknown> }[]) : [];
        const stop = args.stopOnError !== false;
        const out: unknown[] = [];
        for (const op of ops) {
          const r = await run(op.operation, op.args ?? {});
          const body = r.structuredContent ?? r.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
          out.push({ operation: op.operation, ok: !r.isError, result: body });
          if (r.isError && stop) break;
        }
        return text(JSON.stringify(out, null, 1));
      },
    },
    direct(
      "pr_verify",
      "Read-only check: MCP ↔ Premiere connector ↔ open project ↔ active sequence. Call first in a session. " +
        "Connector does not answer while Premiere is open → pr_install_connector (status, then install with the user's consent).",
      { type: "object", properties: {}, _op: "verify_premiere_connection" },
    ),
    direct(
      "pr_get_sequence",
      "Structure of the active sequence: video/audio tracks with clips (node_id, name, start/end/in/out seconds, enabled, speed). node_id is what every clip operation takes.",
      { type: "object", properties: {}, _op: "get_sequence_structure" },
    ),
    direct(
      "pr_save_project",
      "Save the open project (Cmd+S). Do it before exports and before batches of destructive edits.",
      { type: "object", properties: {}, _op: "save_project" },
    ),
    direct(
      "pr_export_frame",
      "Export one frame of the active sequence as PNG at `output_path` (Premiere QE still export, full resolution). `time_seconds` defaults to the playhead. Use it to LOOK at the result of an edit.",
      {
        type: "object",
        properties: {
          output_path: { type: "string", description: "absolute .png path; the folder is created" },
          time_seconds: { type: "number", description: "time in seconds (default: playhead)" },
        },
        required: ["output_path"],
        _op: "export_frame",
      },
    ),
    direct(
      "pr_execute_script",
      "Run raw ExtendScript (ES3: var, no arrow functions/template literals) inside Premiere — app, qe (call app.enableQE() first), app.project.activeSequence… " +
        "Two forms: (a) a plain expression or statements — the value of the LAST expression comes back as {value, type}; " +
        "(b) a function body that ends with `return __result({...})` or `return __error(\"msg\")` — returned as is. " +
        "Helpers in scope: __findSequence(idOrName), __findProjectItem(nodeIdOrName), __findClip(nodeId) → {clip, trackIndex, clipIndex, trackType}, __getAllClips(seq), " +
        "__compIs(comp, name)/__propIs(prop, name, comp)/__nameIn(displayName, name) (English names on any UI language), __qeLookup(\"video\"|\"audio\"|\"videoTransition\", name) → {item, name} or null, __ticksToSeconds/__secondsToTicks, TICKS_PER_SECOND. " +
        "Runtime errors come back as errors. No scripting undo in Premiere 26 — pr_save_project before destructive scripts. Only for what pr_catalog does not cover.",
      {
        type: "object",
        properties: {
          script: { type: "string", description: "ExtendScript source (ES3)" },
          timeout_ms: { type: "number", description: "timeout in ms (default 30000); raise for long scripts" },
        },
        required: ["script"],
        _op: "execute_extendscript",
      },
      mapExecuteScriptArgs,
    ),
    connectorTool(),
    skillTool(),
  ]
    // A direct tool whose operation the capability profile withholds (pr_execute_script without
    // unsafe-script, pr_save_project in read-only mode) is not advertised — it could only fail.
    .filter((spec) => {
      const op = (spec.parameters as { _op?: string })._op;
      return !op || Boolean(tools[op]);
    })
    .map((spec) => {
    // `_op` is an internal marker, not part of the advertised schema
    const { _op, ...parameters } = spec.parameters as Record<string, unknown> & { _op?: string };
    void _op;
    return { ...spec, parameters };
  });
}
