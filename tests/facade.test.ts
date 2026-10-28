// Facade (src/product/facade.ts): pr_execute_script → execute_extendscript.
// 28.09: the facade passed {script} where upstream reads args.code — every
// pr_execute_script ran an empty script («empty result from evalScript»).
import { describe, expect, it, vi } from "vitest";
import { buildFacade, categorize, mapExecuteScriptArgs, type FacadeToolDef } from "../src/product/facade.js";

describe("mapExecuteScriptArgs", () => {
  it("passes a __result/__error body through as `code`", () => {
    const body = "var s = app.project.activeSequence; if (!s) return __error('no seq'); return __result({n: s.name});";
    expect(mapExecuteScriptArgs({ script: body })).toEqual({ code: body });
  });
  it("wraps a plain expression so its value comes back as {value, type}", () => {
    const out = mapExecuteScriptArgs({ script: "app.version + ' | ' + app.project.name", timeout_ms: 5000 });
    expect(out.timeout_ms).toBe(5000);
    const code = String(out.code);
    expect(code).toContain('eval("app.version + \' | \' + app.project.name")');
    expect(code).toMatch(/return __result\(\{ value: .*type: typeof __v \}\);$/);
  });
  it("accepts `code` as an alias and never sends `script` upstream", () => {
    const out = mapExecuteScriptArgs({ code: "return __result({ok: true});" });
    expect(out).toEqual({ code: "return __result({ok: true});" });
    expect(mapExecuteScriptArgs({ script: "1 + 1" })).not.toHaveProperty("script");
  });
});

describe("buildFacade pr_execute_script", () => {
  it("invokes execute_extendscript with the mapped arguments", async () => {
    const tools: Record<string, FacadeToolDef> = categorize("scripting", {
      execute_extendscript: {
        description: "Execute custom ExtendScript code in Premiere Pro.",
        parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
        handler: async () => ({ success: true }),
      },
    });
    const invoke = vi.fn(async (name: string, args: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text: JSON.stringify({ name, args }) }],
    }));
    const spec = buildFacade(tools, invoke).find((s) => s.name === "pr_execute_script");
    expect(spec).toBeDefined();
    expect(spec!.parameters).not.toHaveProperty("_op");
    expect((spec!.parameters as { properties: Record<string, unknown> }).properties).toHaveProperty("timeout_ms");
    await spec!.run({ script: "return __result({v: app.version});" });
    expect(invoke).toHaveBeenCalledWith("execute_extendscript", { code: "return __result({v: app.version});" });
    await spec!.run({ script: "app.version" });
    const [, args] = invoke.mock.calls[1];
    expect(String(args.code)).toContain('eval("app.version")');
  });
});
