import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { capabilitiesForToolInvocation } from "../../src/security/capabilities.js";
import { getObjectMaskUiTools, parseShapes } from "../../src/tools/object-mask-ui.js";
import { resetMonitorCache } from "../../src/ui/object-mask.js";
import { SimPremiere } from "./sim.js";

const dir = mkdtempSync(join(tmpdir(), "objmask-ui-test-"));
const framePath = join(dir, "frame.png");
writeFileSync(framePath, "png");

function tools(sim: SimPremiere, platform: NodeJS.Platform = "darwin") {
  return getObjectMaskUiTools({ desktop: () => sim, platform });
}

const lasso = [[300, 200], [700, 200], [700, 450], [300, 450]];

// Each action locates the Program Monitor once (a multi-scale FFT search, ~2 s here).
describe("object_mask_ui", { timeout: 90_000 }, () => {
  it("creates a mask by a click, adds a lasso part, subtracts, sets params and tracks", async () => {
    const sim = new SimPremiere();
    const r = await tools(sim).object_mask_ui.handler({
      frame_path: framePath, points: [[800, 500]], lassos: [lasso], subtract_points: [[1300, 800]],
      feather: 4, expansion: -2, inverted: true, output_dir: join(dir, "a"),
    });
    expect(r.success).toBe(true);
    const d = r.data as Record<string, any>;
    // the lasso comes first (lassos before points), the click is added with ⊕, the subtract click removes the last part
    expect(d.shapes).toEqual({ created: "lasso", added: 1, subtracted: 1 });
    expect(d.maskIndex).toBe(0);
    expect(d.outcome).toBe("committed_unverified");
    expect(d.overlay.found).toBe(true);
    expect(d.tracking).toEqual({ done: true, seconds: expect.any(Number) });
    expect(sim.trackedWith).toBe("forward");
    expect(sim.inverted).toBe(true);
    expect(sim.actions).toContain("type 4");
    expect(sim.actions).toContain("type -2");
    expect(sim.regions).toHaveLength(1);
    expect(d.mimeType).toBe("image/png");
    expect(Buffer.from(d.base64, "base64").toString()).toMatch(/^png \d+x\d+$/);
    expect(d.overlayImage).toBe(join(dir, "a", "object-mask-overlay.png"));
    expect(d.imageCaption).toMatch(/^Object mask 0: red = masked/);
    expect(d.steps.map((s: { step: string }) => s.step)).toEqual(expect.arrayContaining(["find-monitor", "find-tool", "created", "add", "subtract", "mask-params", "track"]));
  });

  it("selects the tool by its shortcut, tracks both ways or not at all", async () => {
    const sim = new SimPremiere();
    sim.noTool = true;
    const r = await tools(sim).object_mask_ui.handler({ frame_path: framePath, points: [[800, 500]], tool_shortcut: true, track: "both" });
    expect(r.success).toBe(true);
    expect(sim.actions).toContain("key cmd+alt+o");
    expect(sim.trackedWith).toBe("both");

    const sim2 = new SimPremiere();
    const r2 = await tools(sim2).object_mask_ui.handler({ frame_path: framePath, points: [[800, 500]], track: "none", effect_index: 1 });
    expect(r2.success).toBe(true);
    expect((r2.data as Record<string, unknown>).tracking).toBeNull();
    expect(sim2.trackedWith).toBe("");
  });

  it("plans without clicking in dry_run", async () => {
    const sim = new SimPremiere();
    const r = await tools(sim).object_mask_ui.handler({ frame_path: framePath, points: [[800, 500], [100, 100]], subtract_lassos: [lasso], dry_run: true });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ dryRun: true, effectRows: 3, toolFound: true, masksVisible: 0, plan: { createBy: "point", add: 1, subtract: 1, effectIndex: 1 } });
    expect(sim.actions).toEqual([]);
  });

  it("reports failures after clicks as an unknown mutation", async () => {
    const noTool = new SimPremiere();
    noTool.noTool = true;
    const a = await tools(noTool).object_mask_ui.handler({ frame_path: framePath, points: [[800, 500]] });
    expect(a).toMatchObject({ success: false, error: expect.stringMatching(/tool icon not found/), data: { mutationOutcome: "unknown" } });

    const miss = new SimPremiere();
    miss.missShapes = true;
    const b = await tools(miss).object_mask_ui.handler({ frame_path: framePath, points: [[800, 500]] });
    expect(b).toMatchObject({ success: false, error: expect.stringMatching(/no mask row appeared/) });
    expect((b.data as { steps: unknown[] }).steps.length).toBeGreaterThan(0);

    const row = await tools(new SimPremiere()).object_mask_ui.handler({ frame_path: framePath, points: [[800, 500]], effect_index: 7 });
    expect(row).toMatchObject({ success: false, error: expect.stringMatching(/effect row 7 not found/) });

    const outside = await tools(new SimPremiere()).object_mask_ui.handler({ frame_path: framePath, points: [[5000, 10]] });
    expect(outside).toMatchObject({ success: false, error: expect.stringMatching(/outside the exported frame/) });

    const hidden = new SimPremiere();
    hidden.hideMonitor = true;
    const c = await tools(hidden).object_mask_ui.handler({ frame_path: framePath, points: [[800, 500]] });
    expect(c).toMatchObject({ success: false, error: expect.stringMatching(/Program Monitor picture not found/) });
  });

  it("validates its arguments before touching the desktop", async () => {
    const sim = new SimPremiere();
    const t = tools(sim).object_mask_ui;
    expect(await t.handler({ frame_path: framePath })).toMatchObject({ success: false, error: "give at least one point or lasso", data: { mutationOutcome: "not_applied" } });
    expect((await t.handler({ frame_path: framePath, points: [[1]] })).error).toMatch(/must be \[x, y\]/);
    expect((await t.handler({ frame_path: framePath, points: [[1, 2]], subtract_lassos: [[[1, 2]]] })).error).toMatch(/subtract lasso 0 needs at least 3 points/);
    expect((await t.handler({ points: [[1, 2]] })).error).toBe("frame_path is required");
    expect((await t.handler({ frame_path: join(dir, "missing.png"), points: [[1, 2]] })).error).toMatch(/does not exist/);
    expect(sim.actions).toEqual([]);
  });

  it("refuses off macOS and without Accessibility", async () => {
    const sim = new SimPremiere();
    const r = await tools(sim, "linux").object_mask_ui.handler({ frame_path: framePath, points: [[1, 2]] });
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/macOS only/), data: { mutationOutcome: "not_applied" } });
    sim.trusted = false;
    const r2 = await tools(sim).object_mask_select_ui.handler({ mask_index: 0 });
    expect(r2).toMatchObject({ success: false, error: expect.stringMatching(/Accessibility/), data: { mutationOutcome: "not_applied" } });
  });
});

describe("object_mask_edit_ui / select / params / track / inspect", { timeout: 90_000 }, () => {
  it("adds and subtracts parts of an existing mask", async () => {
    const sim = new SimPremiere().withMask();
    const t = tools(sim).object_mask_edit_ui;
    const add = await t.handler({ frame_path: framePath, mode: "add", lassos: [lasso], points: [[1200, 700]], mask_index: 0 });
    expect(add).toMatchObject({ success: true, data: { maskIndex: 0, mode: "add", shapes: 2, overlay: { found: true } } });
    expect(sim.regions).toHaveLength(3);
    const sub = await t.handler({ frame_path: framePath, mode: "subtract", points: [[1200, 700]] });
    expect(sub).toMatchObject({ success: true, data: { mode: "subtract", shapes: 1 } });
    expect(sim.regions).toHaveLength(2);
    expect((sub.data as { imageCaption: string }).imageCaption).toMatch(/after subtract/);
  });

  it("checks the edit arguments and that the mask exists", async () => {
    const sim = new SimPremiere();
    const t = tools(sim).object_mask_edit_ui;
    expect((await t.handler({ frame_path: framePath, mode: "merge", points: [[1, 2]] })).error).toBe("mode must be add or subtract");
    expect((await t.handler({ frame_path: framePath, mode: "add" })).error).toBe("give at least one point or lasso");
    expect((await t.handler({ frame_path: framePath, mode: "add", lassos: "x" })).error).toMatch(/lassos must be an array/);
    expect((await t.handler({ frame_path: framePath, mode: "add", points: {} })).error).toMatch(/points must be an array/);
    const r = await t.handler({ frame_path: framePath, mode: "add", points: [[800, 500]], mask_index: 2 });
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/mask 2 not found \(masks visible in Effect Controls: 0\)/), data: { mutationOutcome: "unknown" } });
  });

  it("fails to edit when ⊕/⊖ do not show (the mask did not get selected)", async () => {
    const sim = new SimPremiere().withMask();
    sim.click = async () => {}; // clicks do nothing → the mask stays unselected
    const r = await tools(sim).object_mask_edit_ui.handler({ frame_path: framePath, mode: "add", points: [[800, 500]] });
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/⊕\/⊖ buttons not found/) });
  });

  it("selects a mask by its row", async () => {
    const sim = new SimPremiere().withMask();
    const r = await tools(sim).object_mask_select_ui.handler({ mask_index: 0 });
    expect(r).toMatchObject({ success: true, data: { selected: 0 } });
    expect(sim.selected).toBe(true);
  });

  it("sets Feather / Expansion / Inverted, leaving Inverted alone when it already matches", async () => {
    const sim = new SimPremiere().withMask();
    const t = tools(sim).object_mask_params_ui;
    expect((await t.handler({ mask_index: 0 })).error).toBe("give feather, expansion or inverted");
    const r = await t.handler({ mask_index: 0, feather: 2.6, inverted: false });
    expect(r).toMatchObject({ success: true, data: { set: { feather: 3, inverted: false } } }); // whole numbers only
    expect(sim.actions).toContain("type 3");
    expect(sim.actions.some((a) => a.startsWith("key cmd+a"))).toBe(false);
    expect(sim.inverted).toBe(false);
    sim.inverted = true;
    await t.handler({ mask_index: 0, inverted: true, expansion: 3 });
    expect(sim.inverted).toBe(true);
    await t.handler({ mask_index: 0, inverted: false });
    expect(sim.inverted).toBe(false);
  });

  it("tracks backward and reports a timeout", async () => {
    const sim = new SimPremiere().withMask();
    const r = await tools(sim).object_mask_track_ui.handler({ mask_index: 0, direction: "backward" });
    expect(r).toMatchObject({ success: true, data: { direction: "backward", done: true } });
    expect(sim.trackedWith).toBe("back");

    const slow = new SimPremiere().withMask();
    slow.progressFrames = 1e9;
    let now = 1_000_000;
    const realNow = Date.now;
    Date.now = () => now;
    slow.onSleep = (ms) => { now += ms; };
    try {
      const r2 = await tools(slow).object_mask_track_ui.handler({ mask_index: 0, timeout_seconds: 10 });
      expect(r2).toMatchObject({ success: false, error: expect.stringMatching(/tracking did not finish in 1\d(\.\d)? s/), data: { mutationOutcome: "unknown" } });
    } finally {
      Date.now = realNow;
    }
  });

  it("finishes tracking when no progress bar ever shows", async () => {
    const sim = new SimPremiere().withMask();
    sim.progressFrames = 0;
    const r = await tools(sim).object_mask_track_ui.handler({ mask_index: 0 });
    expect(r).toMatchObject({ success: true, data: { direction: "forward", done: true } });
    const track = (r.data as { steps: { step: string; progressSeen?: boolean }[] }).steps.find((s) => s.step === "track");
    expect(track?.progressSeen).toBe(false);
  });

  it("measures the selected mask read-only", async () => {
    const sim = new SimPremiere().withMask();
    sim.selected = true;
    const r = await tools(sim).inspect_object_mask_overlay_ui.handler({ frame_path: framePath, output_dir: join(dir, "inspect") });
    expect(r).toMatchObject({ success: true, data: { overlay: { found: true }, masksVisible: 1, imageCaption: "Red = the selected mask on this frame." } });
    expect(sim.actions).toEqual([]);
    sim.selected = false;
    const r2 = await tools(sim).inspect_object_mask_overlay_ui.handler({ frame_path: framePath });
    expect(r2).toMatchObject({ success: true, data: { overlay: { found: false, bboxFrame: null } } });
    expect((r2.data as { imageCaption: string }).imageCaption).toMatch(/No red overlay/);
  });

  it("reuses the monitor found earlier once a mask on Opacity hides the picture", async () => {
    resetMonitorCache();
    const sim = new SimPremiere();
    const created = await tools(sim).object_mask_ui.handler({ frame_path: framePath, points: [[800, 500]], track: "none" });
    expect(created.success).toBe(true);
    sim.transparent = true; // the transparency grid outside the mask, the masked part over it
    const r = await tools(sim).object_mask_edit_ui.handler({ frame_path: framePath, mode: "add", points: [[1200, 700]] });
    expect(r.success).toBe(true);
    const steps = (r.data as { steps: { step: string; reused?: boolean }[] }).steps;
    expect(steps.some((s) => s.step === "find-monitor" && s.reused === true)).toBe(true);
    expect(sim.regions).toHaveLength(2);
    expect((r.data as { overlay: { found: boolean } }).overlay.found).toBe(true);

    // without a remembered monitor (a restart) the action refuses and says how to recover
    resetMonitorCache();
    const lost = await tools(sim).inspect_object_mask_overlay_ui.handler({ frame_path: framePath });
    expect(lost).toMatchObject({ success: false, error: expect.stringMatching(/remembers the monitor .* dry_run/) });
  });

  it("wraps unexpected errors", async () => {
    const sim = new SimPremiere();
    sim.capture = async () => { throw new Error("boom"); };
    const r = await tools(sim).object_mask_select_ui.handler({ mask_index: 0 });
    expect(r).toMatchObject({ success: false, error: "Object Mask UI failed: boom", data: { mutationOutcome: "unknown" } });
  });
});

describe("parseShapes", () => {
  it("puts lassos first and enforces the limits", () => {
    expect(parseShapes([[1, 2]], [[[0, 0], [1, 0], [1, 1]]], "mask").map((s) => s.kind)).toEqual(["lasso", "point"]);
    expect(parseShapes(undefined, undefined, "mask")).toEqual([]);
    expect(() => parseShapes(Array.from({ length: 65 }, () => [1, 2]), undefined, "mask")).toThrow(/at most 64/);
    expect(() => parseShapes(undefined, [Array.from({ length: 257 }, () => [1, 2])], "mask")).toThrow(/more than 256 points/);
    expect(() => parseShapes([[1, Number.NaN]], undefined, "mask")).toThrow(/must be \[x, y\]/);
  });

  it("needs filesystem authority only when output_dir names a folder", () => {
    expect(capabilitiesForToolInvocation("object_mask_ui", { frame_path: "/f.png" })).toEqual(["edit"]);
    expect(capabilitiesForToolInvocation("object_mask_ui", { output_dir: "/out" })).toEqual(["edit", "filesystem"]);
    expect(capabilitiesForToolInvocation("inspect_object_mask_overlay_ui", { output_dir: "/out" })).toEqual(["inspect", "filesystem"]);
    expect(capabilitiesForToolInvocation("inspect_object_mask_overlay_ui", {})).toEqual(["inspect"]);
  });

  it("declares macOS-only local operations with edit / inspect authority", () => {
    const all = getObjectMaskUiTools({ platform: "linux" });
    expect(Object.keys(all)).toEqual(["object_mask_ui", "object_mask_edit_ui", "object_mask_select_ui", "object_mask_params_ui", "object_mask_track_ui", "inspect_object_mask_overlay_ui"]);
    for (const [name, def] of Object.entries(all)) {
      expect(def.operationalCapability).toMatchObject({ backend: "local", status: "experimental", authority: name.startsWith("inspect_") ? "inspect" : "edit" });
      expect(def.description).toMatch(/macOS only/);
    }
  });
});
