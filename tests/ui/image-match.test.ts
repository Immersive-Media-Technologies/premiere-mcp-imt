import { describe, expect, it } from "vitest";

import {
  type GrayImage, boxShrink, cropGray, cropRgb, downscaleGray, encodeBmp, grayFromBytes, parseBmp, resizeGray, resizeRgb, toGray,
} from "../../src/ui/image.js";
import { Correlator, fft1, fft2, findTemplate, nccAt, nextPow2, peaks } from "../../src/ui/match.js";
import { ObjectMaskUi } from "../../src/ui/object-mask.js";
import { FRAME_H, FRAME_W, SimPremiere, rng } from "./sim.js";

function noise(w: number, h: number, seed = 3): GrayImage {
  const r = rng(seed);
  return { w, h, data: Float64Array.from({ length: w * h }, () => r() * 255) };
}

function bmp32(w: number, h: number, topDown: boolean, headerSize: number, masks: [number, number, number]): Buffer {
  const off = 14 + headerSize + (headerSize < 52 ? 12 : 0);
  const buf = Buffer.alloc(off + w * h * 4);
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(off, 10);
  buf.writeUInt32LE(headerSize, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(topDown ? -h : h, 22);
  buf.writeUInt16LE(32, 28);
  buf.writeUInt32LE(3, 30);
  buf.writeUInt32LE(masks[0], 54); buf.writeUInt32LE(masks[1], 58); buf.writeUInt32LE(masks[2], 62);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // pixel (x, y) in image order = r: 10·x, g: 20·y, b: 7
      const row = topDown ? y : h - 1 - y;
      const r = 10 * x, g = 20 * y, b = 7;
      const v = masks[0] === 0x00ff0000 ? (r << 16) | (g << 8) | b : (b << 16) | (g << 8) | r;
      buf.writeUInt32LE(v >>> 0, off + (row * w + x) * 4);
    }
  }
  return buf;
}

describe("image helpers", () => {
  it("round-trips 24-bit BMP with padded rows", () => {
    const img = { w: 3, h: 2, data: Uint8Array.from({ length: 18 }, (_, i) => i * 13) };
    const buf = encodeBmp(img);
    expect(buf.length).toBe(54 + 12 * 2);
    expect(parseBmp(buf)).toEqual(img);
  });

  it("reads 32-bit BI_BITFIELDS, top-down and bottom-up, V3 and V5 headers", () => {
    for (const [top, hs, masks] of [[true, 40, [0x00ff0000, 0x0000ff00, 0x000000ff]], [false, 124, [0x000000ff, 0x0000ff00, 0x00ff0000]]] as const) {
      const img = parseBmp(bmp32(4, 3, top, hs, masks as unknown as [number, number, number]));
      expect([img.w, img.h]).toEqual([4, 3]);
      expect(Array.from(img.data.subarray(((2 * 4) + 3) * 3, ((2 * 4) + 3) * 3 + 3))).toEqual([30, 40, 7]);
    }
    const zero = parseBmp(bmp32(2, 1, true, 40, [0x00ff0000, 0x0000ff00, 0]));
    expect(zero.data[2]).toBe(0);
  });

  it("rejects what it cannot read", () => {
    const good = encodeBmp({ w: 2, h: 2, data: new Uint8Array(12) });
    expect(() => parseBmp(Buffer.from("PNG....."))).toThrow("not a BMP file");
    const noPx = Buffer.from(good); noPx.writeInt32LE(0, 18);
    expect(() => parseBmp(noPx)).toThrow("BMP has no pixels");
    const depth = Buffer.from(good); depth.writeUInt16LE(8, 28);
    expect(() => parseBmp(depth)).toThrow("unsupported BMP depth 8");
    const rle = Buffer.from(good); rle.writeUInt32LE(1, 30);
    expect(() => parseBmp(rle)).toThrow("unsupported BMP compression 1");
    expect(() => parseBmp(good.subarray(0, 60))).toThrow("BMP is truncated");
  });

  it("converts, resizes, shrinks and crops", () => {
    const rgb = { w: 2, h: 1, data: Uint8Array.from([255, 0, 0, 0, 0, 255]) };
    expect(Array.from(toGray(rgb).data).map((v) => Math.round(v))).toEqual([76, 29]);
    expect(() => grayFromBytes(2, 2, new Uint8Array(3))).toThrow(/does not match/);
    const g = noise(40, 30);
    expect(resizeGray(g, 40, 30)).toBe(g);
    const up = resizeGray(g, 80, 60);
    expect([up.w, up.h]).toEqual([80, 60]);
    const flat: GrayImage = { w: 8, h: 8, data: new Float64Array(64).fill(100) };
    expect(Array.from(resizeGray(flat, 3, 3).data).every((v) => Math.abs(v - 100) < 1e-9)).toBe(true);
    expect(boxShrink(flat, 1)).toBe(flat);
    expect(boxShrink(g, 4)).toMatchObject({ w: 10, h: 7 });
    expect(downscaleGray(g, 1)).toBe(g);
    expect(downscaleGray(g, 2.5)).toMatchObject({ w: 16, h: 12 });
    expect(cropGray(g, -5, 25, 10, 10)).toMatchObject({ w: 5, h: 5 });
    expect(cropGray(g, 50, 0, 10, 10)).toMatchObject({ w: 0, h: 10 });
    const c = cropRgb(rgb, 1, 0, 5, 5);
    expect(Array.from(c.data)).toEqual([0, 0, 255]);
    expect(resizeRgb(rgb, 2, 1)).toBe(rgb);
    expect(resizeRgb(rgb, 4, 2)).toMatchObject({ w: 4, h: 2 });
  });
});

describe("template matching", () => {
  it("FFT forward then inverse returns the input", () => {
    const n = 8, re = Float64Array.from({ length: n }, (_, i) => i * i), im = new Float64Array(n);
    const orig = Float64Array.from(re);
    fft1(re, im, n, false);
    fft1(re, im, n, true);
    re.forEach((v, i) => expect(v / n).toBeCloseTo(orig[i], 9));
    const N = 4, M = 2, r2 = Float64Array.from({ length: 8 }, (_, i) => i), i2 = new Float64Array(8);
    fft2(r2, i2, N, M, false);
    expect(r2[0]).toBeCloseTo(28, 9);
    fft2(r2, i2, N, M, true);
    expect(r2[5] / 8).toBeCloseTo(5, 9);
    expect([nextPow2(1), nextPow2(5), nextPow2(64)]).toEqual([1, 8, 64]);
  });

  it("finds a pasted patch exactly, directly and coarse-to-fine", () => {
    const S = noise(120, 90, 11);
    const t = cropGray(S, 70, 40, 16, 12);
    const corr = new Correlator(S);
    const m = corr.ncc(t);
    const best = peaks(m, 0.9, 4)[0];
    expect([best.x, best.y]).toEqual([70, 40]);
    expect(best.score).toBeCloseTo(1, 6);
    expect(nccAt(S, t, 70, 40)).toBeCloseTo(1, 6);
    expect(nccAt(S, t, 110, 85)).toBe(-1);
    expect(nccAt({ w: 20, h: 20, data: new Float64Array(400) }, t, 0, 0)).toBe(0);
    expect(findTemplate(S, null, 1, t, 0.9, 4)[0]).toMatchObject({ x: 70, y: 40 });
    const smooth = resizeGray(noise(30, 23, 5), 120, 90);
    const ts = cropGray(smooth, 60, 30, 32, 24);
    const hit = findTemplate(smooth, new Correlator(downscaleGray(smooth, 2)), 2, ts, 0.9, 6)[0];
    expect([hit.x, hit.y]).toEqual([60, 30]);
  });

  it("handles degenerate inputs", () => {
    const corr = new Correlator(noise(10, 10));
    expect(corr.ncc(noise(20, 5)).w).toBe(0);
    expect(peaks({ w: 0, h: 0, map: new Float64Array(0) }, 0.5, 2)).toEqual([]);
    const flat = corr.ncc({ w: 3, h: 3, data: new Float64Array(9).fill(5) });
    expect(Array.from(flat.map).every((v) => v === 0)).toBe(true);
    const many = corr.ncc(noise(2, 2, 9));
    expect(peaks(many, -1, 0, 5)).toHaveLength(5);
  });
});

describe("ObjectMaskUi guards", () => {
  it("needs the exported frame for monitor and overlay, a located monitor for shapes, 3+ lasso points", async () => {
    const sim = new SimPremiere();
    const blind = new ObjectMaskUi(sim, null);
    expect(blind.current()).toBeNull();
    await expect(blind.monitor()).rejects.toThrow("frame_path is required for this action");
    await expect(blind.overlay()).rejects.toThrow("frame_path is required to measure the mask");
    await expect(blind.applyShape({ kind: "point", x: 1, y: 1 })).rejects.toThrow("internal: monitor not located");
    const ui = new ObjectMaskUi(sim, { rgb: sim.frame, w: FRAME_W, h: FRAME_H }, { afterClick: 0, afterShape: 0, hover: 0, poll: 0 });
    await ui.monitor();
    await expect(ui.applyShape({ kind: "lasso", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })).rejects.toThrow("a lasso needs at least 3 points");
    const st = { x: 40, y: 135, score: 1, nameRowY: 0, buttons: { first: { x: 0, y: 0 }, back: { x: 0, y: 0 }, both: { x: 0, y: 0 }, forward: { x: 0, y: 0 }, last: { x: 0, y: 0 } }, rows: {} as never };
    expect(await ui.track(st, "forward", 0)).toEqual({ done: false, seconds: 0 });
  }, 20_000);
});
