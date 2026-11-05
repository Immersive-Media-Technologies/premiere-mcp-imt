import { describe, expect, it } from "vitest";

import { toGray } from "../../src/ui/image.js";
import { findMonitor, frameToShot } from "../../src/ui/match.js";
import {
  MASK_ROWS, ROW_PITCH, TRACK_BUTTONS, checkboxChecked, findAddSub, findFx, findStrips, findTool, makeShot, measureOverlay, progressVisible, template,
} from "../../src/ui/object-mask.js";
import { BASE, FRAME_H, FRAME_W, SimPremiere } from "./sim.js";

describe.each([1, 2])("UI finders at scale %i", { timeout: 30_000 }, (s) => {
  it("find the tool, the effect rows, the mask strip and ⊕/⊖", async () => {
    const sim = new SimPremiere(s).withMask();
    sim.selected = true;
    const shot = makeShot(await sim.capture());
    expect(shot.s).toBe(s);

    const tool = findTool(shot);
    expect(tool.found).toBe(true);
    expect(tool.score).toBeGreaterThan(0.9);
    expect(Math.abs(tool.x - (BASE.tool[0] + 13) * s)).toBeLessThanOrEqual(1);
    expect(Math.abs(tool.y - (BASE.tool[1] + 16) * s)).toBeLessThanOrEqual(1);

    const fx = findFx(shot);
    expect(fx.found).toBe(true);
    expect(fx.badgeX).toBe(BASE.badgeX * s);
    expect(fx.rows.map((r) => r.y)).toEqual([0, 1, 2].map((i) => sim.rowY(i) + 9 * s));

    const strips = findStrips(shot);
    expect(strips).toHaveLength(1);
    const st = strips[0];
    expect([st.x, st.y]).toEqual([BASE.strip[0] * s, BASE.strip[1] * s]);
    expect(st.buttons.forward).toEqual({ x: (BASE.strip[0] + TRACK_BUTTONS.forward[0]) * s, y: (BASE.strip[1] + 9) * s });
    expect(st.nameRowY).toBeCloseTo((BASE.strip[1] + 9 - ROW_PITCH) * s, 6);
    expect(st.rows.inverted.y).toBeCloseTo((BASE.strip[1] + 9 + MASK_ROWS.inverted * ROW_PITCH) * s, 6);
    expect(st.rows.feather.x).toBe((BASE.strip[0] + 17) * s);

    const ab = findAddSub(shot);
    expect(ab.found).toBe(true);
    expect(ab.add).toEqual({ x: (BASE.addSub[0] + 12) * s, y: (BASE.addSub[1] + 11) * s });
    expect(ab.sub).toEqual({ x: (BASE.addSub[0] + 40) * s, y: (BASE.addSub[1] + 11) * s });
  });

  it("find nothing on an empty window", async () => {
    const sim = new SimPremiere(s);
    sim.noTool = true;
    const shot = makeShot(await sim.capture());
    expect(findTool(shot).found).toBe(false);
    expect(findStrips(shot)).toEqual([]);
    expect(findAddSub(shot).found).toBe(false);
  });
});

// findMonitor is a multi-scale FFT search (~2 s here, several times that under coverage).
describe("Program Monitor and overlay", { timeout: 40_000 }, () => {
  it("locate the exported frame and map frame pixels to the screenshot", async () => {
    const sim = new SimPremiere(1);
    const shot = makeShot(await sim.capture());
    const mon = findMonitor(shot.gray, toGray(sim.frame), FRAME_W, FRAME_H);
    expect(mon.found).toBe(true);
    expect(mon.score).toBeGreaterThan(0.9);
    const m = sim.mon();
    expect(Math.abs(mon.x - m.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(mon.y - m.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(mon.w - m.w)).toBeLessThanOrEqual(4);
    const p = frameToShot(mon, 800, 500);
    const q = sim.toShot(800, 500);
    expect(Math.abs(p.x - q[0])).toBeLessThanOrEqual(3);
    expect(Math.abs(p.y - q[1])).toBeLessThanOrEqual(3);

    // ⊕/⊖ must sit under the monitor
    const above = { ...mon, y: mon.y + 300, h: 10 };
    sim.withMask().selected = true;
    const shot2 = makeShot(await sim.capture());
    expect(findAddSub(shot2, mon).found).toBe(true);
    expect(findAddSub(shot2, above).found).toBe(false);

    // the red overlay of the selected mask → its extent in frame pixels
    const ov = measureOverlay(shot2, sim.frame, mon);
    expect(ov.found).toBe(true);
    expect(ov.areaFrac).toBeGreaterThan(0);
    const [x0, y0, x1, y1] = ov.bboxFrame!;
    expect(x0).toBeLessThan(800);
    expect(x1).toBeGreaterThan(800);
    expect(y0).toBeLessThan(500);
    expect(y1).toBeGreaterThan(500);
    expect(measureOverlay(shot, sim.frame, mon)).toMatchObject({ found: false, areaFrac: 0 });
  });

  it("report a weak match when the monitor does not show the frame", async () => {
    const sim = new SimPremiere(1);
    sim.hideMonitor = true;
    const shot = makeShot(await sim.capture());
    const mon = findMonitor(shot.gray, toGray(sim.frame), FRAME_W, FRAME_H);
    expect(mon.found).toBe(false);
    expect(mon.hint).toMatch(/Fit/);
    const tiny = findMonitor(toGray({ w: 10, h: 10, data: new Uint8Array(300) }), toGray(sim.frame), FRAME_W, FRAME_H);
    expect(tiny).toMatchObject({ found: false, hint: expect.stringMatching(/smaller/) });
  });

  it("see the tracking progress bar", async () => {
    const sim = new SimPremiere(1).withMask();
    const region = { x: -10, y: -10, w: 600, h: 600 };
    expect(progressVisible(makeShot(await sim.capture()), region)).toBe(false);
    sim.tracking = 1;
    expect(progressVisible(makeShot(await sim.capture()), region)).toBe(true);
  });

  it("read the Inverted checkbox and ignore grey-over-blue as «red»", async () => {
    const sim = new SimPremiere(1).withMask();
    const st = () => findStrips(makeShot(sim.lastShot!))[0];
    sim.lastShot = await sim.capture();
    expect(checkboxChecked(makeShot(sim.lastShot), st().rows.inverted)).toBe(false);
    sim.inverted = true;
    sim.lastShot = await sim.capture();
    expect(checkboxChecked(makeShot(sim.lastShot), st().rows.inverted)).toBe(true);
    expect(checkboxChecked(makeShot(sim.lastShot), { x: -50, y: -50 })).toBe(false);

    // a blue-sky frame vs the grey transparency grid: no overlay
    const blue = { w: 4, h: 4, data: new Uint8Array(48).map((_, i) => (i % 3 === 2 ? 220 : 60)) };
    const grey = { img: { w: 4, h: 4, data: new Uint8Array(48).fill(210) }, scale: 1, origin: { x: 0, y: 0 } };
    const mon = { found: true, score: 1, x: 0, y: 0, w: 4, h: 4, frameW: 4, frameH: 4 };
    expect(measureOverlay(makeShot(grey), blue, mon)).toMatchObject({ found: false, areaFrac: 0 });
  });

  it("scale templates for Retina and cache them", () => {
    const a = template("fx", 2);
    expect([a.w, a.h]).toEqual([52, 36]);
    expect(template("fx", 2)).toBe(a);
    expect(template("fx", 1).w).toBe(26);
  });
});
