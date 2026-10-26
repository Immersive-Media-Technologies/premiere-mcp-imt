// pr_skill — serves the Premiere agent skill (skills/pr) from the server itself, so clients that
// cannot load skill folders (a Claude Desktop extension, Cursor, ChatGPT through the gateway) still
// get it. Layouts: source checkout and npm package → <root>/skills/pr; .mcpb → server/skills/pr
// (dist/da/../.. is the package root in all three).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/server";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function skillDir(root: string = ROOT): string {
  return path.join(root, "skills", "pr");
}

/** Reference names (file names without .md) under skills/pr/references. */
export function listSkillDocs(dir: string = skillDir()): string[] {
  const refs = path.join(dir, "references");
  if (!existsSync(refs)) return [];
  return readdirSync(refs)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
}

/**
 * "" / "SKILL" / "SKILL.md" → the router; "generative" / "references/generative.md" → that reference.
 * Null for an unknown name. Names are restricted to [a-z0-9-] — no path traversal.
 */
export function readSkillDoc(doc: string | undefined, dir: string = skillDir()): string | null {
  const d = (doc ?? "").trim().replace(/\\/g, "/");
  if (!d || /^skill(\.md)?$/i.test(d)) {
    const f = path.join(dir, "SKILL.md");
    return existsSync(f) ? readFileSync(f, "utf8") : null;
  }
  const name = d.replace(/^\.?\/?references\//, "").replace(/\.md$/i, "").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  const f = path.join(dir, "references", `${name}.md`);
  return existsSync(f) ? readFileSync(f, "utf8") : null;
}

export function skillTool(dir: string = skillDir()): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<CallToolResult>;
} {
  const docs = listSkillDocs(dir);
  return {
    name: "pr_skill",
    description:
      "The Premiere agent skill. No `doc`: the router — order of work, what scripts cannot do in Premiere, which reference to read; " +
      "read it at the start of any Premiere task beyond a single read or edit. `doc`: one reference — Premiere's AI tools " +
      "(Generative Extend, Generative Media Tool, Object Mask, transcripts and Paper Edit, captions, Enhance Speech/Audio, Search, " +
      "AI Assistant, Auto Reframe, Scene Edit Detection, Morph Cut), multi-tool recipes, gotchas.",
    parameters: {
      type: "object",
      properties: {
        doc: { type: "string", description: docs.length ? `reference: ${docs.join(" | ")}` : "reference name" },
      },
    },
    run: async (args) => {
      const doc = typeof args.doc === "string" ? args.doc : undefined;
      const body = readSkillDoc(doc, dir);
      if (body === null) {
        const list = listSkillDocs(dir);
        return {
          content: [{ type: "text", text: `unknown skill doc '${doc ?? ""}'. Available: ${list.length ? list.join(", ") : "(skill files missing from this install)"}` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: body }] };
    },
  };
}
