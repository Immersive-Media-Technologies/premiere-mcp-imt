// Product switches of the IMT build: facade by default, boolean env flags from .mcpb settings,
// read-only / script capability switches, the connector installer tool.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { facadeInstructions } from "../src/da/instructions.js";
import { extendGuiPath } from "../src/da/pathfix.js";
import { listSkillDocs, readSkillDoc, skillTool } from "../src/da/skill.js";
import { envFlag } from "../src/da/envflag.js";
import { buildFacade, facadeEnabled } from "../src/da/facade.js";
import { connectorCommand } from "../src/da/connector.js";
import { isToolPermitted, resolveCapabilities } from "../src/security/capabilities.js";

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["PR_MCP_FACADE", "PR_MCP_READONLY", "PR_MCP_ENABLE_SCRIPT"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("envFlag", () => {
  it("accepts true/false from .mcpb settings and 1/0 from hand-written configs", () => {
    expect(envFlag("true", false)).toBe(true);
    expect(envFlag("1", false)).toBe(true);
    expect(envFlag("false", true)).toBe(false);
    expect(envFlag("0", true)).toBe(false);
    expect(envFlag(undefined, true)).toBe(true);
    expect(envFlag("  ", false)).toBe(false);
  });
});

describe("facade is the default", () => {
  it("on without the variable, off with PR_MCP_FACADE=0 or false", () => {
    delete process.env.PR_MCP_FACADE;
    expect(facadeEnabled()).toBe(true);
    process.env.PR_MCP_FACADE = "0";
    expect(facadeEnabled()).toBe(false);
    process.env.PR_MCP_FACADE = "false";
    expect(facadeEnabled()).toBe(false);
  });
  it("advertises pr_install_connector and pr_skill; hides direct tools the profile withholds", () => {
    const def = { description: "", parameters: {}, handler: vi.fn() };
    const names = buildFacade({ verify_premiere_connection: def }, vi.fn()).map((s) => s.name);
    expect(names).toContain("pr_install_connector");
    expect(names).toContain("pr_skill");
    expect(names).toContain("pr_verify");
    expect(names).not.toContain("pr_execute_script");
    expect(names).not.toContain("pr_save_project");
  });
  it("server instructions point to pr_skill and stay short", () => {
    const t = facadeInstructions();
    expect(t).toContain("pr_skill");
    expect(t.length).toBeLessThan(1500);
  });
});

describe("pr_skill", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "prskill-"));
  mkdirSync(path.join(dir, "references"));
  writeFileSync(path.join(dir, "SKILL.md"), "router");
  writeFileSync(path.join(dir, "references", "generative.md"), "gen");

  it("serves the router and references and refuses anything else", () => {
    expect(readSkillDoc(undefined, dir)).toBe("router");
    expect(readSkillDoc("SKILL.md", dir)).toBe("router");
    expect(readSkillDoc("generative", dir)).toBe("gen");
    expect(readSkillDoc("references/generative.md", dir)).toBe("gen");
    expect(readSkillDoc("../SKILL", dir)).toBeNull();
    expect(readSkillDoc("nope", dir)).toBeNull();
    expect(listSkillDocs(dir)).toEqual(["generative"]);
  });
  it("advertises the references and errors on an unknown one", async () => {
    const t = skillTool(dir);
    expect(JSON.stringify(t.parameters)).toContain("generative");
    expect((await t.run({ doc: "nope" })).isError).toBe(true);
    expect((await t.run({})).content[0]).toMatchObject({ text: "router" });
  });
  it("shipped skill: every reference named in SKILL.md exists, none is orphaned", () => {
    const real = path.resolve("skills/pr");
    const router = readSkillDoc(undefined, real) ?? "";
    const named = new Set([...router.matchAll(/references\/([a-z0-9-]+)\.md/g)].map((m) => m[1]));
    expect(named.size).toBeGreaterThan(0);
    for (const n of named) expect(readSkillDoc(n, real), n).not.toBeNull();
    expect([...named].sort()).toEqual(listSkillDocs(real));
  });
});

describe("ExtendScript templates", () => {
  // In a TS template literal `\"` becomes a bare `"`; inside an ExtendScript string that ends the
  // string and the whole command fails as "EvalScript error." (apply_effect, remove_effect … on every
  // call before 0.1.0 — found live on Windows 26.5.2).
  it("contain no single-backslash quote inside buildToolScript templates", () => {
    const hits: string[] = [];
    for (const file of readdirSync(path.resolve("src/tools")).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(path.resolve("src/tools", file), "utf8");
      const re = /buildToolScript\(\s*`/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        let i = m.index + m[0].length;
        let depth = 0;
        const start = i;
        while (i < src.length) {
          const c = src[i];
          if (c === "\\") { i += 2; continue; }
          if (c === "$" && src[i + 1] === "{") { depth++; i += 2; continue; }
          if (c === "}" && depth > 0) { depth--; i++; continue; }
          if (c === "`" && depth === 0) break;
          i++;
        }
        const body = src.slice(start, i);
        for (const q of body.matchAll(/(?<!\\)\\"/g)) {
          hits.push(`${file}:${src.slice(0, start + (q.index ?? 0)).split("\n").length}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("GUI client PATH", () => {
  it("adds the Homebrew folders on macOS only", () => {
    const mac = { PATH: ["/usr/bin", "/bin"].join(path.delimiter) } as NodeJS.ProcessEnv;
    expect(extendGuiPath(mac, "darwin")?.split(path.delimiter)).toEqual(["/usr/bin", "/bin", "/opt/homebrew/bin", "/usr/local/bin"]);
    const win = { PATH: "C:\\tools" } as NodeJS.ProcessEnv;
    expect(extendGuiPath(win, "win32")).toBe("C:\\tools");
  });
});

describe("capability switches", () => {
  it("default profile has no unsafe-script; PR_MCP_ENABLE_SCRIPT adds it", () => {
    delete process.env.PR_MCP_READONLY;
    delete process.env.PR_MCP_ENABLE_SCRIPT;
    expect([...resolveCapabilities(undefined).capabilities].sort()).toEqual(["edit", "export", "filesystem", "inspect"]);
    process.env.PR_MCP_ENABLE_SCRIPT = "true";
    expect(resolveCapabilities(undefined).capabilities.has("unsafe-script")).toBe(true);
  });
  it("read-only keeps inspect and frame export only, and wins over the script switch", () => {
    process.env.PR_MCP_READONLY = "true";
    process.env.PR_MCP_ENABLE_SCRIPT = "true";
    expect([...resolveCapabilities(undefined).capabilities].sort()).toEqual(["export", "inspect"]);
  });
  it("read-only keeps the connection check (pr_verify) advertised", () => {
    process.env.PR_MCP_READONLY = "true";
    expect(isToolPermitted("verify_premiere_connection", resolveCapabilities(undefined))).toBe(true);
    expect(isToolPermitted("save_project", resolveCapabilities(undefined))).toBe(false);
  });
  it("an explicit PREMIERE_MCP_CAPABILITIES list wins over the switches", () => {
    process.env.PR_MCP_READONLY = "true";
    expect([...resolveCapabilities("inspect,edit").capabilities].sort()).toEqual(["edit", "inspect"]);
  });
});

describe("connector installer command", () => {
  it("macOS: install-cep.sh --diagnose / --copy", () => {
    expect(connectorCommand("status", "darwin", "/r")).toEqual({ cmd: "bash", args: [path.join("/r", "scripts", "install-cep.sh"), "--diagnose"] });
    expect(connectorCommand("install", "darwin", "/r")?.args.at(-1)).toBe("--copy");
  });
  it("Windows: install-cep.ps1, -Diagnose only for status; other platforms unsupported", () => {
    expect(connectorCommand("status", "win32", "/r")?.args.at(-1)).toBe("-Diagnose");
    expect(connectorCommand("install", "win32", "/r")?.args).not.toContain("-Diagnose");
    expect(connectorCommand("install", "linux", "/r")).toBeNull();
  });
});
