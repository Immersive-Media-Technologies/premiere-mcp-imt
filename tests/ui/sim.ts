// A simulated Premiere window for the Object Mask UI tests: it draws the icons the finders look for
// (fx badges, Object Mask tool, mask tracker strip, ⊕/⊖) and the Program Monitor, and reacts to the
// clicks and drags the actions send the way Premiere 26.5 did in live runs. Kept small (500×400 at 1:1)
// so the FFT searches stay fast.
import { writeFileSync } from "node:fs";

import { type GrayImage, type RgbImage, resizeRgb } from "../../src/ui/image.js";
import { type Capture, DesktopError } from "../../src/ui/mac.js";
import { template } from "../../src/ui/object-mask.js";
import type { UiDesktop } from "../../src/tools/object-mask-ui.js";

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function blank(w: number, h: number, v = 38, seed = 1): RgbImage {
  const r = rng(seed);
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const n = v + Math.floor(r() * 6);
    data[i * 3] = n; data[i * 3 + 1] = n; data[i * 3 + 2] = n + 1;
  }
  return { w, h, data };
}

/** Gray blocks with fine noise — a stand-in for a video frame (gray, so no false «red» at block edges). */
export function frameImage(w: number, h: number, seed = 7): RgbImage {
  const r = rng(seed);
  const img = blank(w, h, 0, seed);
  const block = 10, cols = Math.ceil(w / block);
  const vals: number[] = [];
  for (let i = 0; i < cols * Math.ceil(h / block); i++) vals.push(r() * 200 + 25);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.min(255, Math.round(vals[Math.floor(y / block) * cols + Math.floor(x / block)] + r() * 8));
      img.data.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
  }
  return img;
}

export function pasteGray(dst: RgbImage, t: GrayImage, x: number, y: number): void {
  for (let yy = 0; yy < t.h; yy++) {
    for (let xx = 0; xx < t.w; xx++) {
      const X = x + xx, Y = y + yy;
      if (X < 0 || Y < 0 || X >= dst.w || Y >= dst.h) continue;
      const v = Math.round(t.data[yy * t.w + xx]);
      dst.data.fill(v, (Y * dst.w + X) * 3, (Y * dst.w + X) * 3 + 3);
    }
  }
}

export function pasteRgb(dst: RgbImage, src: RgbImage, x: number, y: number): void {
  for (let yy = 0; yy < src.h; yy++) dst.data.set(src.data.subarray(yy * src.w * 3, (yy + 1) * src.w * 3), ((y + yy) * dst.w + x) * 3);
}

export function tintRed(img: RgbImage, r: readonly number[]): void {
  for (let y = Math.max(0, r[1]); y < Math.min(img.h, r[3]); y++) {
    for (let x = Math.max(0, r[0]); x < Math.min(img.w, r[2]); x++) {
      const i = (y * img.w + x) * 3;
      img.data[i] = 255; img.data[i + 1] = Math.round(img.data[i + 1] * 0.3); img.data[i + 2] = Math.round(img.data[i + 2] * 0.3);
    }
  }
}

/** Positions at 1:1 (multiplied by the scale). */
export const BASE = {
  W: 500, H: 400,
  badgeX: 10, badgeY: [50, 100, 170], rowShift: 100,
  tool: [10, 340],
  monitor: { x: 200, y: 20, w: 280, h: 175 },
  strip: [40, 135],
  addSub: [300, 230],
} as const;

export const FRAME_W = 1600;
export const FRAME_H = 1000;

/** Premiere as far as these tools see it. Shape points are in exported-frame pixels (FRAME_W × FRAME_H). */
export class SimPremiere implements UiDesktop {
  readonly frame = frameImage(400, 250);
  readonly actions: string[] = [];
  readonly saved: string[] = [];
  effectRow = -1;
  toolActive = false;
  masks = 0;
  selected = false;
  mode: "add" | "sub" | null = null;
  tracking = 0;
  trackedWith = "";
  inverted = false;
  regions: number[][] = [];
  noTool = false;
  missShapes = false;
  hideMonitor = false;
  transparent = false;
  progressFrames = 2;
  trusted = true;
  slept = 0;
  onSleep: ((ms: number) => void) | null = null;
  lastShot: Capture | null = null;

  constructor(readonly s = 1) {}

  get W(): number { return BASE.W * this.s; }
  get H(): number { return BASE.H * this.s; }
  mon(): { x: number; y: number; w: number; h: number } {
    const m = BASE.monitor, s = this.s;
    return { x: m.x * s, y: m.y * s, w: m.w * s, h: m.h * s };
  }
  rowY(i: number): number { return (BASE.badgeY[i] + (this.masks && i >= 2 ? BASE.rowShift : 0)) * this.s; }
  stripY(): number { return BASE.strip[1] * this.s; }
  /** frame px → screenshot px */
  toShot(px: number, py: number): [number, number] {
    const m = this.mon();
    return [m.x + (px * m.w) / FRAME_W, m.y + (py * m.h) / FRAME_H];
  }
  private inMonitor(x: number, y: number): boolean {
    const m = this.mon();
    return x >= m.x && y >= m.y && x < m.x + m.w && y < m.y + m.h;
  }

  async checkAccess(): Promise<void> {
    if (!this.trusted) throw new DesktopError("Accessibility permission is missing (simulated)");
  }
  async front(): Promise<string> { return "Adobe Premiere Pro 2026"; }
  async decode(): Promise<RgbImage> { return this.frame; }
  async imageSize(): Promise<{ w: number; h: number }> { return { w: FRAME_W, h: FRAME_H }; }
  async savePng(img: RgbImage, path: string): Promise<string> {
    writeFileSync(path, Buffer.from(`png ${img.w}x${img.h}`));
    this.saved.push(path);
    return path;
  }
  async sleep(ms: number): Promise<void> {
    this.slept += ms;
    this.onSleep?.(ms);
  }

  async capture(): Promise<Capture> {
    const s = this.s;
    const img = blank(this.W, this.H);
    for (let i = 0; i < 3; i++) pasteGray(img, template("fx", s), BASE.badgeX * s, this.rowY(i));
    if (!this.noTool) pasteGray(img, template("tool", s), BASE.tool[0] * s, BASE.tool[1] * s);
    const m = this.mon();
    if (this.transparent) {
      // a mask on Opacity: the transparency grid outside the mask, the masked parts over it
      for (let y = m.y; y < m.y + m.h; y++) {
        for (let x = m.x; x < m.x + m.w; x++) {
          const v = (Math.floor((x - m.x) / (8 * s)) + Math.floor((y - m.y) / (8 * s))) % 2 ? 205 : 235;
          img.data.fill(v, (y * img.w + x) * 3, (y * img.w + x) * 3 + 3);
        }
      }
    } else if (!this.hideMonitor) pasteRgb(img, resizeRgb(this.frame, m.w, m.h), m.x, m.y);
    if (this.masks) {
      pasteGray(img, template("tracker", s), BASE.strip[0] * s, this.stripY());
      if (this.inverted) {
        const cx = (BASE.strip[0] + 12) * s, cy = Math.round(this.stripY() + 9 * s + 5 * 21.3 * s);
        for (let y = cy - 3 * s; y <= cy + 3 * s; y++) for (let x = cx - 3 * s; x <= cx + 3 * s; x++) img.data.set([40, 120, 220], (y * img.w + x) * 3);
      }
      if (this.selected) {
        // ⊕/⊖ show only while the Object Mask tool is active (live 05.11)
        if (this.toolActive) {
          pasteGray(img, template("add", s), BASE.addSub[0] * s, BASE.addSub[1] * s);
          pasteGray(img, template("sub", s), (BASE.addSub[0] + 28) * s, BASE.addSub[1] * s);
        }
        for (const r of this.regions) tintRed(img, r);
      }
    }
    // the blue frame of the focused panel: a 1 px line, never «progress»
    for (let x = 0; x < 190 * s; x++) img.data.set([72, 147, 234], ((BASE.strip[1] - 60) * s * img.w + x) * 3);
    if (this.tracking > 0) {
      for (let y = this.stripY() + 30 * s; y < this.stripY() + 36 * s; y++) {
        for (let x = 0; x < 200 * s; x++) img.data.set([107, 155, 217], (y * img.w + BASE.strip[0] * s + x) * 3);
      }
      this.tracking--;
    }
    return { img, scale: s, origin: { x: 0, y: 0 } };
  }

  private shape(x0: number, y0: number, x1: number, y1: number): void {
    const was = this.mode;
    this.mode = null;
    if (this.missShapes) return;
    const p = 6 * this.s;
    const r = [Math.round(x0 - p), Math.round(y0 - p), Math.round(x1 + p), Math.round(y1 + p)];
    // a selected mask in ⊕/⊖ mode takes the shape (Premiere: the tool stays active after a mask exists);
    // a shape with the tool active and no mask in edit mode creates a new mask on the selected effect
    if (this.selected && was === "add") {
      this.regions.push(r);
    } else if (this.selected && was === "sub") {
      this.regions.pop();
    } else if (this.toolActive && this.effectRow >= 0) {
      this.masks = 1;
      this.selected = true;
      this.regions = [r];
    }
  }

  async click(x: number, y: number): Promise<void> {
    const s = this.s;
    this.actions.push(`click ${Math.round(x)},${Math.round(y)}`);
    for (let i = 0; i < 3; i++) {
      if (Math.abs(y - (this.rowY(i) + 9 * s)) < 6 * s && x > (BASE.badgeX + 40) * s && x < (BASE.badgeX + 120) * s) { this.effectRow = i; return; }
    }
    if (Math.abs(x - (BASE.tool[0] + 13) * s) < 6 * s && Math.abs(y - (BASE.tool[1] + 16) * s) < 6 * s) { this.toolActive = true; return; }
    if (this.masks) {
      const mid = this.stripY() + 9 * s;
      if (Math.abs(y - (mid - 21.3 * s)) < 5 * s) { this.selected = true; return; }
      if (Math.abs(y - mid) < 5 * s && x > BASE.strip[0] * s && x < (BASE.strip[0] + 126) * s) {
        const dx = x / s - BASE.strip[0];
        this.trackedWith = dx < 27 ? "first" : dx < 50 ? "back" : dx < 74 ? "both" : dx < 98 ? "forward" : "last";
        this.tracking = this.progressFrames;
        this.selected = false;
        return;
      }
      if (Math.abs(x - (BASE.strip[0] + 12) * s) < 4 * s && Math.abs(y - (mid + 5 * 21.3 * s)) < 5 * s) { this.inverted = !this.inverted; return; }
    }
    if (this.selected && Math.abs(y - (BASE.addSub[1] + 11) * s) < 6 * s) {
      if (Math.abs(x - (BASE.addSub[0] + 12) * s) < 6 * s) { this.mode = "add"; return; }
      if (Math.abs(x - (BASE.addSub[0] + 40) * s) < 6 * s) { this.mode = "sub"; return; }
    }
    if (this.inMonitor(x, y)) this.shape(x, y, x, y);
  }

  async move(x: number, y: number): Promise<void> {
    this.actions.push(`move ${Math.round(x)},${Math.round(y)}`);
  }

  async drag(points: { x: number; y: number }[]): Promise<void> {
    this.actions.push(`drag ${points.length}`);
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    if (points.every((p) => this.inMonitor(p.x, p.y))) this.shape(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  }

  async key(combo: string): Promise<void> {
    this.actions.push(`key ${combo}`);
    if (combo === "cmd+alt+o") this.toolActive = true;
  }

  async type(text: string): Promise<void> {
    this.actions.push(`type ${text}`);
  }

  /** A mask that already exists (for the edit / select / params / track tools). */
  withMask(): this {
    this.masks = 1;
    const [x, y] = this.toShot(800, 500);
    this.regions = [[Math.round(x - 10), Math.round(y - 10), Math.round(x + 10), Math.round(y + 10)]];
    return this;
  }
}
