// A simulated Premiere for the Time Remapping UI tests: Effect Controls with the fx headers and the Speed
// keyframe navigator «◀ ◇ ▶», a Timeline panel with its toolbar, ruler, playhead, the selected clip (light
// borders, fx badge), its speed-keyframe strip with hourglass handles, the fx badge's context menu, and the
// scripting half (clip facts, playhead, undo index). It reacts the way Premiere 26.5 did in live runs: the
// ◇ adds a keyframe at the playhead, a Shift-drag of a handle moves the keyframe (and the ones to its
// right, and the clip end) after a 3 px dead zone, "=" / "-" zoom around the playhead, the view scrolls to
// keep the playhead on screen, Return does not pick a menu item (the highlighted item must be clicked).
import { writeFileSync } from "node:fs";

import { type RgbImage } from "../../src/ui/image.js";
import { type Capture, DesktopError } from "../../src/ui/mac.js";
import { template } from "../../src/ui/object-mask.js";
import type { ClipInfo, RemapBridge } from "../../src/ui/time-remap.js";
import type { RemapDesktop } from "../../src/tools/time-remap-ui.js";
import { blank, pasteGray } from "./sim.js";

const W = 1400, H = 520;
const FRAME = 0.04;
/** timeline geometry (1:1) */
const TL = { tools: [200, 200] as const, rulerY: 226, x0: 400, x1: 1350, top: 300, bottom: 360, stripY: 310, stripH: 10 };
/** Effect Controls geometry */
const EC = { badgeX: 10, badgeY: [40, 70, 100] as const, nav: [60, 118] as const, diamondDx: 17 };

const PLAYHEAD: [number, number, number] = [64, 150, 243];
const CLIP: [number, number, number] = [0, 85, 118];
const HIGHLIGHT: [number, number, number] = [18, 85, 187];
const KEY_BLUE: [number, number, number] = [93, 170, 247];

function fill(img: RgbImage, x0: number, y0: number, x1: number, y1: number, rgb: readonly [number, number, number]): void {
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(img.h, Math.round(y1)); y++) {
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(img.w, Math.round(x1)); x++) img.data.set(rgb, (y * img.w + x) * 3);
  }
}

export interface SimKey { seq: number; source: number }

export class SimTimeline implements RemapDesktop, RemapBridge {
  readonly actions: string[] = [];
  readonly saved: string[] = [];
  /** the clip, at 100 % before any keyframe */
  clipStart = 0;
  clipEnd = 4;
  inPoint = 0;
  outPoint = 4;
  speed = 1;
  reversed = false;
  nextStart: number | null = null;
  keys: SimKey[] = [];
  playheadT = 0;
  pps = 120;
  maxPps = 2000;
  viewStart = 0;
  speedShown = false;
  tracksTall = true;
  /** a clip whose track shows keyframes only after Shift+= */
  needsTallTracks = false;
  tool: "select" | "pen" = "pen";
  selected = false;
  menu: { x: number; y: number; highlight: number; sub: boolean } | null = null;
  noMenu = false;
  deadZonePx = 3;
  dragging: { index: number; moved: number } | null = null;
  undo = 10;
  trusted = true;
  slept = 0;

  constructor(readonly s = 1) {}

  // ----------------------------------------------------------------------------------------- bridge
  async clip(): Promise<ClipInfo> {
    return {
      name: "sim.mp4", start: this.clipStart, end: this.clipEnd, inPoint: this.inPoint, outPoint: this.outPoint,
      speed: this.speed, reversed: this.reversed, frame: FRAME, nextStart: this.nextStart,
    };
  }
  async selectOnly(): Promise<void> { this.selected = true; }
  async setPlayhead(seconds: number): Promise<number> {
    this.playheadT = Math.max(0, Math.round(seconds / FRAME) * FRAME);
    this.scrollToPlayhead();
    return this.playheadT;
  }
  async getPlayhead(): Promise<number> { return this.playheadT; }
  async undoIndex(): Promise<number | null> { return this.undo; }

  // ---------------------------------------------------------------------------------------- desktop
  async checkAccess(): Promise<void> {
    if (!this.trusted) throw new DesktopError("Accessibility permission is missing (simulated)");
  }
  async front(): Promise<string> { return "Adobe Premiere Pro 2026"; }
  async decode(): Promise<RgbImage> { return blank(10, 10); }
  async imageSize(): Promise<{ w: number; h: number }> { return { w: 10, h: 10 }; }
  async savePng(img: RgbImage, path: string): Promise<string> {
    writeFileSync(path, Buffer.from(`png ${img.w}x${img.h}`));
    this.saved.push(path);
    return path;
  }
  async sleep(ms: number): Promise<void> { this.slept += ms; }
  async type(text: string): Promise<void> { this.actions.push(`type ${text}`); }
  async drag(): Promise<void> { this.actions.push("drag"); }
  async move(): Promise<void> {}

  private tx(t: number): number { return (TL.x0 + (t - this.viewStart) * this.pps) * this.s; }
  /** the view never starts before 0 and never shows more than the sequence (clip + 1 s) needs */
  private clampView(): void {
    const visible = (TL.x1 - TL.x0) / this.pps;
    this.viewStart = Math.max(0, Math.min(this.viewStart, Math.max(0, this.clipEnd + 1 - visible)));
  }
  private scrollToPlayhead(): void {
    const x = this.tx(this.playheadT) / this.s;
    if (x < TL.x0 || x > TL.x1) this.viewStart = this.playheadT - (TL.x1 - TL.x0) * 0.4 / this.pps;
    this.clampView();
  }
  /** "=" / "-": the time under the playhead stays where it is on screen */
  private zoomAround(factor: number): void {
    const xBefore = this.tx(this.playheadT) / this.s;
    this.pps = Math.max(5, Math.min(this.maxPps, this.pps * factor));
    this.viewStart = this.playheadT - (xBefore - TL.x0) / this.pps;
    this.clampView();
    this.scrollToPlayhead();
  }
  private keyUnderPlayhead(): number {
    return this.keys.findIndex((k) => Math.abs(k.seq - this.playheadT) < FRAME / 2);
  }

  async capture(): Promise<Capture> {
    const s = this.s;
    const img = blank(W * s, H * s, 29);
    // Effect Controls: three fx headers, the Speed navigator under the third
    for (let i = 0; i < 3; i++) pasteGray(img, template("fx", s), EC.badgeX * s, EC.badgeY[i] * s);
    pasteGray(img, template("keynav", s), EC.nav[0] * s, EC.nav[1] * s);
    const filled = this.keyUnderPlayhead() >= 0;
    const dx = (EC.nav[0] + EC.diamondDx) * s, dy = (EC.nav[1] + 1) * s;
    pasteGray(img, template(filled ? "keydiamondFilled" : "keydiamond", s), dx, dy);
    if (filled) {
      for (let y = dy + 3 * s; y < dy + 11 * s; y++) {
        for (let x = dx + 3 * s; x < dx + 11 * s; x++) {
          const i = (y * img.w + x) * 3;
          if (img.data[i] > 120) img.data.set(KEY_BLUE, i);
        }
      }
    }
    // Timeline: toolbar, ruler, the clip, its strip and handles, the playhead
    pasteGray(img, template("tltools", s), TL.tools[0] * s, TL.tools[1] * s);
    fill(img, TL.x0 * s, (TL.rulerY + 6) * s, TL.x1 * s, (TL.rulerY + 7) * s, [120, 120, 60]);
    const cx0 = Math.max(TL.x0 * s, this.tx(this.clipStart)), cx1 = Math.min(TL.x1 * s, this.tx(this.clipEnd));
    if (cx1 > cx0) {
      fill(img, cx0, TL.top * s, cx1, (TL.bottom + 2) * s, CLIP);
      if (this.selected) {
        const b = 235;
        fill(img, cx0, TL.top * s, cx1, (TL.top + 2) * s, [b, b, b]);
        fill(img, cx0, TL.bottom * s, cx1, (TL.bottom + 2) * s, [b, b, b]);
        if (this.tx(this.clipStart) >= TL.x0 * s) fill(img, cx0, TL.top * s, cx0 + 2 * s, (TL.bottom + 2) * s, [b, b, b]);
        if (this.tx(this.clipEnd) <= TL.x1 * s) fill(img, cx1 - 2 * s, TL.top * s, cx1, (TL.bottom + 2) * s, [b, b, b]);
      }
      if (this.tx(this.clipEnd) <= TL.x1 * s) pasteGray(img, template("tlfx", s), cx1 - 22 * s, (TL.top + 3) * s);
      if (this.speedShown && (this.tracksTall || !this.needsTallTracks)) {
        fill(img, cx0 + 2 * s, TL.stripY * s, cx1 - 2 * s, (TL.stripY + TL.stripH) * s, [235, 235, 235]);
        if (this.selected) {
          // the selected clip's trim boxes at both ends of the strip (live 05.11: 11 px wide at s = 1)
          fill(img, cx0 + 6 * s, (TL.stripY + 1) * s, cx0 + 17 * s, (TL.stripY + TL.stripH - 1) * s, [150, 150, 150]);
          fill(img, cx1 - 17 * s, (TL.stripY + 1) * s, cx1 - 6 * s, (TL.stripY + TL.stripH - 1) * s, [150, 150, 150]);
        }
        for (const k of this.keys) {
          const x = this.tx(k.seq);
          if (x < cx0 + 6 * s || x > cx1 - 6 * s) continue;
          fill(img, x - 4 * s, TL.stripY * s, x + 4 * s, (TL.stripY + TL.stripH) * s, [120, 120, 120]);
          for (let y = (TL.stripY + TL.stripH) * s; y < (TL.bottom - 2) * s; y += 2 * s) fill(img, x - s, y, x + s, y + s, [200, 200, 200]);
        }
      }
    }
    const px = this.tx(this.playheadT);
    if (px >= TL.x0 * s - 1 && px <= TL.x1 * s + 1) {
      fill(img, px, (TL.rulerY - 6) * s, px + s, (TL.bottom + 60) * s, PLAYHEAD);
      fill(img, px - 4 * s, (TL.rulerY - 4) * s, px + 5 * s, (TL.rulerY + 3) * s, PLAYHEAD);
    }
    // the context menu of the fx badge
    if (this.menu) {
      const m = this.menu;
      fill(img, m.x, m.y + 6 * s, m.x + 180 * s, m.y + 106 * s, [42, 42, 42]);
      if (m.highlight >= 0) {
        const ry = m.y + (8 + 24 * m.highlight) * s;
        fill(img, m.x + 4 * s, ry, m.x + 176 * s, ry + 20 * s, HIGHLIGHT);
        if (m.sub) fill(img, m.x + 186 * s, ry, m.x + 262 * s, ry + 20 * s, HIGHLIGHT);
      }
    }
    return { img, scale: s, origin: { x: 0, y: 0 } };
  }

  async click(x: number, y: number, mods: string[] = []): Promise<void> {
    const s = this.s;
    this.actions.push(`click ${Math.round(x)},${Math.round(y)}${mods.length ? " " + mods.join("+") : ""}`);
    if (this.menu) {
      const m = this.menu, ry = m.y + (8 + 24 * m.highlight) * s;
      if (m.sub && m.highlight === 2 && x >= m.x + 186 * s && x <= m.x + 262 * s && y >= ry && y <= ry + 20 * s) this.speedShown = true;
      this.menu = null;
      return;
    }
    // the ◇ / ◆ of the Speed navigator
    const dcx = (EC.nav[0] + EC.diamondDx + 6.5) * s, dcy = (EC.nav[1] + 7.5) * s;
    if (Math.abs(x - dcx) < 6 * s && Math.abs(y - dcy) < 6 * s) {
      const i = this.keyUnderPlayhead();
      if (i >= 0) this.keys.splice(i, 1);
      else this.keys.push({ seq: this.playheadT, source: this.inPoint + (this.playheadT - this.clipStart) });
      this.keys.sort((a, b) => a.seq - b.seq);
      this.undo++;
      return;
    }
    // the ruler: moves the playhead there
    if (Math.abs(y - TL.rulerY * s) <= 6 * s && x >= TL.x0 * s && x <= TL.x1 * s) {
      this.playheadT = Math.round((this.viewStart + (x / s - TL.x0) / this.pps) / FRAME) * FRAME;
      return;
    }
    if (this.tool === "pen" && y > TL.top * s && y < TL.bottom * s) throw new Error("simulated: a Pen-tool click on the clip would add a keyframe");
  }

  async rightClick(x: number, y: number): Promise<void> {
    this.actions.push(`rclick ${Math.round(x)},${Math.round(y)}`);
    const s = this.s, cx1 = Math.min(TL.x1 * s, this.tx(this.clipEnd));
    if (this.noMenu) return;
    if (Math.abs(x - (cx1 - 14 * s)) < 10 * s && Math.abs(y - (TL.top + 9) * s) < 8 * s) this.menu = { x, y, highlight: -1, sub: false };
  }

  async key(combo: string): Promise<void> {
    this.actions.push(`key ${combo}`);
    if (this.menu) {
      if (combo === "down") this.menu.highlight = Math.min(3, this.menu.highlight + 1);
      else if (combo === "right") this.menu.sub = this.menu.highlight === 2;
      else if (combo === "escape") this.menu = null;
      return;
    }
    if (combo === "v") this.tool = "select";
    else if (combo === "equal") this.zoomAround(1.5);
    else if (combo === "minus") this.zoomAround(1 / 1.5);
    else if (combo === "shift+equal") this.tracksTall = true;
  }

  async mouseDown(x: number, y: number, mods: string[] = []): Promise<void> {
    this.actions.push(`down ${Math.round(x)},${Math.round(y)} ${mods.join("+")}`);
    const s = this.s;
    if (!mods.includes("shift") || !this.speedShown || y < TL.stripY * s || y > (TL.stripY + TL.stripH) * s) return;
    const i = this.keys.findIndex((k) => Math.abs(this.tx(k.seq) - x) <= 5 * s);
    if (i >= 0) this.dragging = { index: i, moved: 0 };
  }

  async mouseDragBy(dx: number, _dy: number, mods: string[] = []): Promise<void> {
    this.actions.push(`dragby ${Math.round(dx * 10) / 10}`);
    if (!this.dragging || !mods.includes("shift")) return;
    const d = this.dragging, before = d.moved;
    d.moved += dx;
    // the first pixels of a drag do nothing (Premiere's drag threshold), then the keyframe follows 1:1
    const eff = Math.sign(d.moved) * Math.max(0, Math.abs(d.moved) - this.deadZonePx * this.s) - Math.sign(before) * Math.max(0, Math.abs(before) - this.deadZonePx * this.s);
    const dt = eff / this.s / this.pps;
    if (!dt) return;
    for (let j = d.index; j < this.keys.length; j++) this.keys[j].seq += dt;
    this.clipEnd += dt;
  }

  async mouseUp(): Promise<void> {
    this.actions.push("up");
    if (this.dragging) this.undo++;
    this.dragging = null;
  }

  /** speed keyframes already on the clip (shown on the timeline) */
  withKeys(...seq: number[]): this {
    this.speedShown = true;
    this.keys = seq.map((t) => ({ seq: t, source: t }));
    return this;
  }
}

export const SIM_FRAME = FRAME;
