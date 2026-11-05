import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { capabilitiesForToolInvocation } from "../../src/security/capabilities.js";
import { getTimeRemapUiTools } from "../../src/tools/time-remap-ui.js";
import { makeShot } from "../../src/ui/object-mask.js";
import {
  type ClipInfo, RemapPlanError, findClipBox, findKeyStrip, findSpeedNav, findTimelineRuler, keyHandles, menuHighlight, planRemap,
  playheadColumns, timelineHeadX,
} from "../../src/ui/time-remap.js";
import { SIM_FRAME, SimTimeline } from "./remap-sim.js";

const dir = mkdtempSync(join(tmpdir(), "time-remap-test-"));

function tools(sim: SimTimeline, platform: NodeJS.Platform = "darwin") {
  return getTimeRemapUiTools({}, { desktop: () => sim, bridge: () => sim, platform });
}

const info: ClipInfo = { name: "c", start: 0, end: 4, inPoint: 0, outPoint: 4, speed: 1, reversed: false, frame: SIM_FRAME, nextStart: null };
const three = [{ source_seconds: 1, sequence_seconds: 1 }, { source_seconds: 2, sequence_seconds: 2.8 }, { source_seconds: 3, sequence_seconds: 3.4 }];

describe("planRemap", () => {
  it("places each keyframe on its media frame and computes the speed of the segment to its left", () => {
    const plan = planRemap(info, [{ source: 1, sequence: 1 }, { source: 2, sequence: 2.8 }, { source: 3, sequence: 3.4 }]);
    expect(plan.map((k) => [k.source, k.initial, k.target])).toEqual([[1, 1, 1], [2, 2, 2.8], [3, 3, 3.4]]);
    expect(plan.map((k) => Math.round(k.speedLeft * 1000) / 1000)).toEqual([1, 0.556, 1.667]);
  });
  it("snaps times to sequence frames and accounts for the clip's in point and start", () => {
    const plan = planRemap({ ...info, start: 10, inPoint: 2, outPoint: 6, end: 14 }, [{ source: 3.013, sequence: 11.5 }]);
    expect(plan[0]).toMatchObject({ source: 3, initial: 11, target: 11.52 });
    expect(plan[0].speedLeft).toBeCloseTo(1 / 1.52, 6);
  });
  it("refuses what cannot be placed, before any click", () => {
    const bad = (i: ClipInfo, pts: { source: number; sequence: number }[]) => expect(() => planRemap(i, pts)).toThrow(RemapPlanError);
    bad(info, []);
    bad(info, [{ source: 5, sequence: 1 }]);
    bad(info, [{ source: 1, sequence: 1 }, { source: 1, sequence: 2 }]);
    bad(info, [{ source: 1, sequence: 1 }, { source: 2, sequence: 1 }]);
    bad(info, [{ source: 1, sequence: 20 }]);
    bad(info, [{ source: 3, sequence: 0.2 }]);
    bad({ ...info, reversed: true }, [{ source: 1, sequence: 1 }]);
    bad({ ...info, speed: 0.5 }, [{ source: 1, sequence: 1 }]);
    bad({ ...info, nextStart: 4.2 }, [{ source: 1, sequence: 2 }]);
    bad({ ...info, frame: NaN }, [{ source: 1, sequence: 1 }]);
    expect(() => planRemap({ ...info, nextStart: 5 }, [{ source: 1, sequence: 2 }])).not.toThrow();
  });
});

describe("finders on the simulated timeline", { timeout: 60_000 }, () => {
  it("finds the ruler, the playhead, the selected clip, its strip, handles and the Speed navigator", async () => {
    const sim = new SimTimeline().withKeys(1, 2.6);
    sim.selected = true;
    await sim.setPlayhead(2.6);
    const shot = makeShot(await sim.capture());
    const ruler = findTimelineRuler(shot);
    expect(ruler).toMatchObject({ x: 200, y: 200, rulerY: 226 });
    const head = timelineHeadX(shot, ruler!);
    expect(head).toBe(400 + 2.6 * 120);
    expect(playheadColumns(shot.cap.img, 1)).toContain(head);
    const box = findClipBox(shot, head!);
    expect(box).toMatchObject({ top: 300, bottom: 360, left: 400, right: 400 + 4 * 120 - 1, cutLeft: false, cutRight: false });
    const st = findKeyStrip(shot, head!);
    expect(st).toMatchObject({ y0: 310, y1: 319, selected: true, playheadX: head });
    expect(keyHandles(shot, st!).map(Math.round)).toEqual([520, 712]);
    const nav = findSpeedNav(shot);
    expect(nav.found).toBe(true);
    expect(nav.filled).toBe(true);
    expect(nav.diamond!.x).toBeCloseTo(83.5, 0);
    await sim.setPlayhead(1.5);
    expect(findSpeedNav(makeShot(await sim.capture())).filled).toBe(false);
    expect(findTimelineRuler(shot, ruler)).toMatchObject({ x: 200, y: 200 });
  });
  it("reads a cut clip, a hidden strip and the menu highlight", async () => {
    const sim = new SimTimeline();
    sim.selected = true;
    sim.pps = 600;
    await sim.setPlayhead(2);
    const shot = makeShot(await sim.capture());
    const head = timelineHeadX(shot, findTimelineRuler(shot)!)!;
    expect(findClipBox(shot, head)).toMatchObject({ cutLeft: true, cutRight: true });
    expect(findKeyStrip(shot, head)).toBeNull();
    expect(menuHighlight(shot, { x: 0, y: 0, w: 1400, h: 520 })).toBeNull();
    await sim.rightClick(shot.cap.img.w, 0); // nowhere: no menu
    expect(sim.menu).toBeNull();
    sim.menu = { x: 700, y: 300, highlight: 1, sub: false };
    const h = menuHighlight(makeShot(await sim.capture()), { x: 650, y: 300, w: 400, h: 200 });
    expect(h).toMatchObject({ x0: 704, x1: 875 });
    expect(h!.y).toBeCloseTo(341.5, 0);
  });
});

describe("time_remap_ui", { timeout: 120_000 }, () => {
  it("shows Speed on the clip, adds three keyframes and drags them onto their targets", async () => {
    const sim = new SimTimeline();
    const r = await tools(sim).time_remap_ui.handler({ node_id: "c1", points: three, output_dir: join(dir, "a") });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const d = r.data as Record<string, unknown>;
    expect(d.outcome).toBe("verified");
    expect(d.clip).toMatchObject({ endBeforeSeconds: 4, endSeconds: 4.4, expectedEndSeconds: 4.4, endMatches: true });
    expect(d.keyframesCounted).toBe(3);
    expect(d.worstOffsetFrames as number).toBeLessThanOrEqual(0.1);
    expect((d.keyframes as { speedLeftPercent: number }[]).map((k) => Math.round(k.speedLeftPercent))).toEqual([100, 56, 167]);
    expect(sim.keys.map((k) => Math.round(k.seq * 1000) / 1000)).toEqual([1, 2.8, 3.4]);
    expect(sim.speedShown).toBe(true);
    expect(sim.tool).toBe("select");
    expect(d.undo).toEqual({ undoStackIndexBefore: 10, undoStackIndex: 15, undoSteps: 5 });
    const steps = (d.steps as { step: string }[]).map((s) => s.step);
    expect(steps).toContain("show_speed_keyframes");
    expect(steps).toContain("selection_tool");
    expect(steps.filter((s) => s === "add_keyframe")).toHaveLength(3);
    expect(steps.filter((s) => s === "shift_drag").length).toBeGreaterThanOrEqual(2);
    expect(sim.actions.filter((a) => a.startsWith("down ")).every((a) => a.endsWith("shift"))).toBe(true);
    expect(d.timelineImage).toMatch(/time-remap\.png$/);
    expect(typeof d.base64).toBe("string");
  });
  it("makes the tracks taller when the clip draws no keyframe strip, and fits a short clip at a coarse zoom", async () => {
    const sim = new SimTimeline();
    sim.needsTallTracks = true;
    sim.tracksTall = false;
    sim.pps = 20;
    const r = await tools(sim).time_remap_ui.handler({ node_id: "c1", points: [{ source_seconds: 2, sequence_seconds: 3 }], tolerance_frames: 0.5 });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect((r.data as { steps: { step: string }[] }).steps.map((s) => s.step)).toContain("taller_tracks");
    expect(sim.tracksTall).toBe(true);
    expect(sim.keys[0].seq).toBeCloseTo(3, 1);
    expect(sim.clipEnd).toBeCloseTo(5, 1);
  });
  it("dry_run returns the plan without touching Premiere", async () => {
    const sim = new SimTimeline();
    const r = await tools(sim).time_remap_ui.handler({ node_id: "c1", points: three, dry_run: true });
    expect(r.success).toBe(true);
    expect((r.data as { plan: { speedLeftPercent: number }[] }).plan.map((k) => k.speedLeftPercent)).toEqual([100, 55.5556, 166.6667]);
    expect(sim.actions).toEqual([]);
    const bad = await tools(sim).time_remap_ui.handler({ node_id: "c1", points: [{ source_seconds: 9, sequence_seconds: 1 }], dry_run: true });
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/media range.*Nothing was changed/);
  });
  it("refuses before any click: bad arguments, another platform, a clip that already has keyframes, no menu", async () => {
    const t = tools(new SimTimeline());
    expect((await t.time_remap_ui.handler({ points: three })).error).toMatch(/node_id/);
    expect((await t.time_remap_ui.handler({ node_id: "c", points: [] })).error).toMatch(/non-empty/);
    expect((await t.time_remap_ui.handler({ node_id: "c", points: [{ source_seconds: -1, sequence_seconds: 1 }] })).error).toMatch(/point 0/);
    expect((await t.time_remap_ui.handler({ node_id: "c", points: three, tolerance_frames: 5 })).error).toMatch(/tolerance_frames/);
    const linux = await tools(new SimTimeline(), "linux").time_remap_ui.handler({ node_id: "c", points: three });
    expect(linux.error).toMatch(/macOS/);
    expect((linux.data as { mutationOutcome: string }).mutationOutcome).toBe("not_applied");
    const withKeys = new SimTimeline().withKeys(0.5);
    const k = await tools(withKeys).time_remap_ui.handler({ node_id: "c", points: three });
    expect(k.error).toMatch(/already has 1 speed keyframe/);
    expect(withKeys.keys).toHaveLength(1);
    const noMenu = new SimTimeline();
    noMenu.noMenu = true;
    const m = await tools(noMenu).time_remap_ui.handler({ node_id: "c", points: three });
    expect(m.error).toMatch(/opened no menu/);
    expect((m.data as { mutationOutcome: string }).mutationOutcome).toBe("not_applied");
    const untrusted = new SimTimeline();
    untrusted.trusted = false;
    expect((await tools(untrusted).time_remap_ui.handler({ node_id: "c", points: three })).error).toMatch(/Accessibility/);
  });
  it("reports an unknown outcome when a keyframe does not appear after the ◇ click", async () => {
    const sim = new SimTimeline();
    const realClick = sim.click.bind(sim);
    sim.click = async (x, y, mods) => {
      await realClick(x, y, mods);
      if (sim.keys.length) sim.keys = []; // Premiere dropped the keyframe
    };
    const r = await tools(sim).time_remap_ui.handler({ node_id: "c", points: three });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no speed keyframe appeared/);
    expect((r.data as { mutationOutcome: string }).mutationOutcome).toBe("unknown");
  });
});

describe("inspect_time_remap_ui", { timeout: 60_000 }, () => {
  it("measures the keyframes on screen and puts the playhead back", async () => {
    const sim = new SimTimeline().withKeys(1, 2.8, 3.4);
    sim.clipEnd = 4.4;
    await sim.setPlayhead(0.2);
    const r = await tools(sim).inspect_time_remap_ui.handler({ node_id: "c", output_dir: join(dir, "i") });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const d = r.data as { shown: boolean; keyframeSeconds: number[]; precisionFrames: number };
    expect(d.shown).toBe(true);
    expect(d.keyframeSeconds.map((t) => Math.round(t * 100) / 100)).toEqual([1, 2.8, 3.4]);
    expect(d.precisionFrames).toBeLessThan(0.2);
    expect(sim.playheadT).toBeCloseTo(0.2, 6);
    expect(sim.keys).toHaveLength(3);
  });
  it("says when the clip shows no speed keyframes", async () => {
    const sim = new SimTimeline();
    const r = await tools(sim).inspect_time_remap_ui.handler({ node_id: "c" });
    expect(r.success).toBe(true);
    expect((r.data as { shown: boolean }).shown).toBe(false);
    expect((await tools(sim).inspect_time_remap_ui.handler({})).error).toMatch(/node_id/);
  });
});

describe("registration", () => {
  it("needs filesystem authority only with output_dir", () => {
    expect(capabilitiesForToolInvocation("time_remap_ui", { node_id: "c", points: three })).toEqual(["edit"]);
    expect(capabilitiesForToolInvocation("time_remap_ui", { node_id: "c", points: three, output_dir: "/o" })).toEqual(["edit", "filesystem"]);
    expect(capabilitiesForToolInvocation("inspect_time_remap_ui", { node_id: "c" })).toEqual(["inspect"]);
    expect(capabilitiesForToolInvocation("inspect_time_remap_ui", { node_id: "c", output_dir: "/o" })).toEqual(["inspect", "filesystem"]);
  });
  it("exposes the two tools with schemas", () => {
    const all = getTimeRemapUiTools({});
    expect(Object.keys(all)).toEqual(["time_remap_ui", "inspect_time_remap_ui"]);
    expect(all.time_remap_ui.parameters.required).toEqual(["node_id", "points"]);
    expect(all.time_remap_ui.operationalCapability.authority).toBe("edit");
    expect(all.inspect_time_remap_ui.operationalCapability.authority).toBe("inspect");
  });
});
