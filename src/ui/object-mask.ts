// Object Mask in Premiere Pro through its UI (no scripting API exists for masks): finders on a window
// capture and the click/drag sequences that create, extend, select, tune and track an object mask.
// Facts from live runs on Premiere 26.5 (macOS, 4K at 1:1):
//  - one click with the Object Mask tool on the Program Monitor = one mask holding the WHOLE object;
//    a closed lasso drag (selection mode Lasso) takes only the outlined part;
//  - the mask is assigned to the effect whose header row is selected in Effect Controls;
//  - ⊕ / ⊖ under the monitor add to / subtract from the SELECTED mask; Premiere drops the selection
//    after tracking or a playhead move, so actions select the mask by its name row first;
//  - the mask row «Inspector |◀ ◀ ◀▶ ▶ ▶|» starts tracking; Sharpness, Feather, Opacity, Expansion and
//    Inverted rows follow it at a fixed pitch.
import { type GrayImage, type RgbImage, cropRgb, downscaleGray, grayFromBytes, resizeGray, resizeRgb, toGray } from "./image.js";
import { type Capture, type Desktop } from "./mac.js";
import { type Hit, type MonitorRect, Correlator, findMonitor, findTemplate, frameToShot } from "./match.js";
import { UI_TEMPLATES, type UiTemplateName } from "./templates.js";

/** offsets inside the tracker-strip template (1:1): |◀ ◀ ◀▶ ▶ ▶| */
export const TRACK_BUTTONS = { first: [15, 9], back: [39, 9], both: [62, 9], forward: [86, 9], last: [111, 9] } as const;
export type TrackButton = keyof typeof TRACK_BUTTONS;
export const ROW_PITCH = 21.3;
export const MASK_ROWS = { sharpness: 1, feather: 2, opacity: 3, expansion: 4, inverted: 5 } as const;
const VALUE_DX = 17;
const CHECK_DX = 12;
const NAME_DX = 80;
const EFFECT_ROW_DX = 60;

export interface Point { x: number; y: number }
export type Shape = { kind: "point"; x: number; y: number } | { kind: "lasso"; points: Point[] };

export interface Shot {
  readonly cap: Capture;
  readonly gray: GrayImage;
  /** pixels per 1:1 template pixel (= display backing scale) */
  readonly s: number;
  coarse(): { corr: Correlator; k: number };
}

export function makeShot(cap: Capture): Shot {
  const gray = toGray(cap.img);
  const s = cap.scale > 0 ? cap.scale : 1;
  let memo: { corr: Correlator; k: number } | null = null;
  return {
    cap, gray, s,
    coarse() {
      if (!memo) {
        const k = 2 * s;
        memo = { corr: new Correlator(downscaleGray(gray, k)), k };
      }
      return memo;
    },
  };
}

const tplCache = new Map<string, GrayImage>();
export function template(name: UiTemplateName, s: number): GrayImage {
  const key = `${name}@${s}`;
  let t = tplCache.get(key);
  if (!t) {
    const src = UI_TEMPLATES[name];
    const base = grayFromBytes(src.w, src.h, Buffer.from(src.b64, "base64"));
    t = s === 1 ? base : resizeGray(base, src.w * s, src.h * s);
    tplCache.set(key, t);
  }
  return t;
}

function find(shot: Shot, name: UiTemplateName, minScore: number, minDist: number): { hits: Hit[]; t: GrayImage } {
  const t = template(name, shot.s);
  const { corr, k } = shot.coarse();
  return { hits: findTemplate(shot.gray, corr, k, t, minScore, Math.round(minDist * shot.s)), t };
}

export interface ToolHit { found: boolean; x: number; y: number; score: number }

export function findTool(shot: Shot): ToolHit {
  const { hits, t } = find(shot, "tool", 0.6, 13);
  if (!hits.length) return { found: false, x: 0, y: 0, score: 0 };
  return { found: true, x: hits[0].x + t.w / 2, y: hits[0].y + t.h / 2, score: round(hits[0].score) };
}

export interface FxRows { found: boolean; badgeX: number; rows: { x: number; y: number; score: number }[] }

/** Effect header rows («fx» badges) top to bottom: 0 Motion, 1 Opacity, 2 Time Remapping, 3… added effects. */
export function findFx(shot: Shot): FxRows {
  const { hits, t } = find(shot, "fx", 0.7, 8);
  if (!hits.length) return { found: false, badgeX: 0, rows: [] };
  const xs = hits.map((h) => h.x).sort((a, b) => a - b);
  const col = xs[Math.floor(xs.length / 2)];
  const rows = hits
    .filter((h) => Math.abs(h.x - col) <= 6 * shot.s)
    .sort((a, b) => a.y - b.y)
    .map((h) => ({ x: h.x + t.w / 2, y: h.y + t.h / 2, score: round(h.score) }));
  return { found: true, badgeX: col, rows };
}

export interface Strip {
  x: number;
  y: number;
  score: number;
  buttons: Record<TrackButton, Point>;
  /** the mask's name row (click it to select the mask) */
  nameRowY: number;
  rows: Record<keyof typeof MASK_ROWS, Point>;
}

/** Mask rows («Inspector |◀ ◀ ◀▶ ▶ ▶|») top to bottom. */
export function findStrips(shot: Shot): Strip[] {
  const { hits } = find(shot, "tracker", 0.6, 30);
  const s = shot.s;
  return hits
    .sort((a, b) => a.y - b.y)
    .map((h) => {
      const buttons = Object.fromEntries(
        Object.entries(TRACK_BUTTONS).map(([k, [dx, dy]]) => [k, { x: h.x + dx * s, y: h.y + dy * s }]),
      ) as Record<TrackButton, Point>;
      const midY = h.y + TRACK_BUTTONS.forward[1] * s;
      const rows = Object.fromEntries(
        Object.entries(MASK_ROWS).map(([k, n]) => [k, { x: h.x + (k === "inverted" ? CHECK_DX : VALUE_DX) * s, y: midY + n * ROW_PITCH * s }]),
      ) as Record<keyof typeof MASK_ROWS, Point>;
      return { x: h.x, y: h.y, score: round(h.score), buttons, nameRowY: midY - ROW_PITCH * s, rows };
    });
}

export interface AddSub { found: boolean; add?: Point; sub?: Point }

/** ⊕ / ⊖ of the mask bar under the monitor: a pair on one line, ⊖ 18–45 px right of ⊕. */
export function findAddSub(shot: Shot, mon?: MonitorRect): AddSub {
  const s = shot.s;
  const a = find(shot, "add", 0.6, 10), b = find(shot, "sub", 0.6, 10);
  const inside = (h: Hit): boolean =>
    !mon || (h.y > mon.y + mon.h - 4 * s && h.x >= mon.x - 300 * s && h.x <= mon.x + mon.w + 300 * s);
  let best: { sc: number; add: Hit; sub: Hit } | null = null;
  for (const ha of a.hits.filter(inside)) {
    for (const hb of b.hits.filter(inside)) {
      const dx = hb.x - ha.x;
      if (dx >= 18 * s && dx <= 45 * s && Math.abs(hb.y - ha.y) <= 3 * s && (!best || ha.score + hb.score > best.sc)) {
        best = { sc: ha.score + hb.score, add: ha, sub: hb };
      }
    }
  }
  if (!best) return { found: false };
  return {
    found: true,
    add: { x: best.add.x + a.t.w / 2, y: best.add.y + a.t.h / 2 },
    sub: { x: best.sub.x + b.t.w / 2, y: best.sub.y + b.t.h / 2 },
  };
}

export interface Overlay {
  found: boolean;
  areaFrac: number;
  /** [x0, y0, x1, y1] in exported-frame pixels */
  bboxFrame?: [number, number, number, number];
  crop: RgbImage;
}

/** The selected mask's red overlay in the monitor vs the plain exported frame → its extent. */
export function measureOverlay(shot: Shot, frame: RgbImage, mon: MonitorRect): Overlay {
  const crop = cropRgb(shot.cap.img, mon.x, mon.y, mon.w, mon.h);
  const ref = resizeRgb(frame, crop.w, crop.h);
  let n = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      const i = (y * crop.w + x) * 3;
      // the pixel must itself be reddish: with a mask on Opacity the monitor shows the transparency
      // grid outside the mask, and grey minus a blue sky would otherwise read as «more red»
      const cr = crop.data[i] - Math.max(crop.data[i + 1], crop.data[i + 2]);
      const red = cr - (ref.data[i] - Math.max(ref.data[i + 1], ref.data[i + 2]));
      if (cr > 30 && red > 50) {
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const total = Math.max(1, crop.w * crop.h);
  const out: Overlay = { found: n > 50, areaFrac: Math.round((n / total) * 10000) / 10000, crop };
  if (out.found) {
    const sx = mon.frameW / crop.w, sy = mon.frameH / crop.h;
    out.bboxFrame = [Math.round(x0 * sx), Math.round(y0 * sy), Math.round(x1 * sx), Math.round(y1 * sy)];
  }
  return out;
}

/**
 * Premiere's tracking progress: a blue horizontal BAR (≈ rgb 107,155,217) in Effect Controls — a
 * continuous run of at least 40 px on at least 3 consecutive rows. Blue parameter values never make a
 * 40 px run; the blue frame of the focused panel is a 1–2 px line.
 */
export function progressVisible(shot: Shot, region: { x: number; y: number; w: number; h: number }): boolean {
  const img = shot.cap.img;
  const x0 = Math.max(0, Math.floor(region.x)), y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(img.w, Math.floor(region.x + region.w)), y1 = Math.min(img.h, Math.floor(region.y + region.h));
  const need = 40 * shot.s, rowsNeeded = Math.max(3, Math.round(3 * shot.s));
  let rows = 0;
  for (let y = y0; y < y1; y++) {
    let run = 0, hit = false;
    for (let x = x0; x < x1 && !hit; x++) {
      const i = (y * img.w + x) * 3, r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      if (b > 180 && b - r > 80 && g > 120 && g < 195) hit = ++run >= need;
      else run = 0;
    }
    rows = hit ? rows + 1 : 0;
    if (rows >= rowsNeeded) return true;
  }
  return false;
}

/** The Inverted checkbox: checked = a light box with a dark tick; unchecked = a dark box with a light rim. */
export function checkboxChecked(shot: Shot, c: Point): boolean {
  const img = shot.cap.img, s = shot.s;
  let n = 0, sum = 0;
  for (let y = Math.round(c.y - 4 * s); y <= Math.round(c.y + 2 * s); y++) {
    for (let x = Math.round(c.x - 3 * s); x <= Math.round(c.x + 3 * s); x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const i = (y * img.w + x) * 3;
      sum += (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
      n++;
    }
  }
  return n > 0 && sum / n > 90;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// The Program Monitor rect found last (per server process), reused while the window is unchanged.
interface MonitorCache { key: string; x: number; y: number; w: number; h: number }
let monitorCache: MonitorCache | null = null;
/** live runs: the true monitor scores 0.98–0.99; a partly transparent picture matched a wrong panel at 0.55 */
const STRONG_MONITOR_SCORE = 0.9;
const WEAK_MONITOR_SCORE = 0.7;

export function resetMonitorCache(): void {
  monitorCache = null;
}

function windowKey(shot: Shot): string {
  return `${shot.cap.img.w}x${shot.cap.img.h}@${shot.cap.origin.x},${shot.cap.origin.y}`;
}

/**
 * The monitor's picture area sits on the flat dark panel background: a thin ring just outside the
 * rect is dark and even, and the ring just inside it is not the same flat dark.
 */
export function pictureAreaPlausible(shot: Shot, r: { x: number; y: number; w: number; h: number }): boolean {
  const g = shot.gray, d0 = 2 * shot.s, d1 = 5 * shot.s;
  const ring = (inset: number, outset: number): { mean: number; sd: number; n: number } => {
    let n = 0, s = 0, s2 = 0;
    const add = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) return;
      const v = g.data[Math.floor(y) * g.w + Math.floor(x)];
      n++; s += v; s2 += v * v;
    };
    for (let k = inset; k <= outset; k++) {
      for (let x = r.x - k; x <= r.x + r.w + k; x += 2) { add(x, r.y - k); add(x, r.y + r.h + k); }
      for (let y = r.y - k; y <= r.y + r.h + k; y += 2) { add(r.x - k, y); add(r.x + r.w + k, y); }
    }
    const mean = n ? s / n : 0;
    return { mean, sd: n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : 0, n };
  };
  const out = ring(d0, d1), inside = ring(-d1, -d0);
  if (out.n < 40 || inside.n < 40) return false;
  return out.mean < 90 && out.sd < 14 && (Math.abs(inside.mean - out.mean) > 10 || inside.sd > 14);
}

// ── actions ──────────────────────────────────────────────────────────────────

export interface ExportedFrame {
  /** a downscaled RGB copy of the exported frame (≤ 1600 px wide is plenty) */
  rgb: RgbImage;
  /** the exported frame's own pixel size (points are given in it) */
  w: number;
  h: number;
}

export interface Step { step: string; [k: string]: unknown }

export class MaskUiError extends Error {
  constructor(message: string, readonly steps: Step[]) {
    super(message);
  }
}

export interface Timing {
  afterClick: number;
  afterShape: number;
  hover: number;
  poll: number;
}

export const DEFAULT_TIMING: Timing = { afterClick: 600, afterShape: 3000, hover: 1200, poll: 2000 };

export class ObjectMaskUi {
  readonly steps: Step[] = [];
  private shot: Shot | null = null;
  private mon: MonitorRect | null = null;
  private lastMaskIndex: number | null = null;

  constructor(private readonly desktop: Desktop, private readonly frame: ExportedFrame | null, private readonly timing: Timing = DEFAULT_TIMING) {}

  private log(step: string, data: Record<string, unknown> = {}): void {
    this.steps.push({ step, ...data });
  }

  private fail(message: string): never {
    throw new MaskUiError(message, this.steps);
  }

  /** The latest capture (null before the first). */
  current(): Shot | null {
    return this.shot;
  }

  async snap(): Promise<Shot> {
    this.shot = makeShot(await this.desktop.capture());
    return this.shot;
  }

  /**
   * Locate the exported frame in the Program Monitor (needed for any point or lasso). Once a mask
   * drives Opacity, the monitor shows only the masked part over the transparency grid and the picture
   * no longer matches the frame: then the rect found last time is reused if the window has not changed
   * and the rect still looks like the monitor's picture area.
   */
  async monitor(): Promise<MonitorRect> {
    if (!this.frame) this.fail("frame_path is required for this action");
    const shot = this.shot ?? (await this.snap());
    const g = toGray(this.frame.rgb);
    const mon = findMonitor(shot.gray, g, this.frame.w, this.frame.h);
    this.log("find-monitor", { found: mon.found, score: mon.score, rect: [mon.x, mon.y, mon.w, mon.h] });
    const key = windowKey(shot);
    const c = monitorCache;
    const cacheUsable = !!c && c.key === key && Math.abs(c.w / c.h - this.frame.w / this.frame.h) < 0.01 * (c.w / c.h) && pictureAreaPlausible(shot, c);
    // A clear content match wins. A weak one (a partly transparent picture can match some other
    // panel at 0.5–0.6) does not beat a remembered rect that still looks like the monitor.
    if (mon.found && (mon.score >= STRONG_MONITOR_SCORE || (!cacheUsable && mon.score >= WEAK_MONITOR_SCORE))) {
      monitorCache = { key, x: mon.x, y: mon.y, w: mon.w, h: mon.h };
      this.mon = mon;
      return mon;
    }
    if (c && cacheUsable) {
      const cached: MonitorRect = { found: true, score: 0, x: c.x, y: c.y, w: c.w, h: c.h, frameW: this.frame.w, frameH: this.frame.h, hint: "reused" };
      this.log("find-monitor", { found: true, reused: true, rect: [c.x, c.y, c.w, c.h] });
      this.mon = cached;
      return cached;
    }
    this.fail(`Program Monitor picture not found: ${mon.hint ?? `only a weak match (score ${mon.score})`}. With a mask on Opacity the monitor shows only the masked part; this server remembers the monitor from its earlier calls in the same window layout — after a restart or a layout change run object_mask_ui with dry_run while the monitor shows the whole picture.`);
  }

  private toShot(p: Point): Point {
    if (!this.mon) this.fail("internal: monitor not located");
    if (p.x < 0 || p.y < 0 || p.x > this.mon.frameW || p.y > this.mon.frameH) {
      this.fail(`point ${p.x},${p.y} is outside the exported frame (${this.mon.frameW}×${this.mon.frameH})`);
    }
    return frameToShot(this.mon, p.x, p.y);
  }

  /** Click (whole object) or closed lasso drag (only the outlined part) with the Object Mask tool active. */
  async applyShape(shape: Shape): Promise<void> {
    if (shape.kind === "point") {
      const p = this.toShot(shape);
      await this.desktop.move(p.x, p.y);
      await this.desktop.sleep(this.timing.hover);
      await this.desktop.click(p.x, p.y);
    } else {
      if (shape.points.length < 3) this.fail("a lasso needs at least 3 points");
      const pts = shape.points.map((p) => this.toShot(p));
      await this.desktop.drag([...pts, pts[0]]);
    }
    await this.desktop.sleep(this.timing.afterShape);
  }

  /** Select the n-th mask (top to bottom) by its name row — ⊕/⊖ need a selected mask. */
  async selectMask(index: number): Promise<Strip> {
    const shot = await this.snap();
    const strips = findStrips(shot);
    const fx = findFx(shot);
    if (index < 0 || index >= strips.length) this.fail(`mask ${index} not found (masks visible in Effect Controls: ${strips.length}) — select the clip so Effect Controls shows it and expand its masks`);
    if (!fx.found) this.fail("Effect Controls not found — open it and select the clip");
    const st = strips[index];
    await this.desktop.click(fx.badgeX + NAME_DX * shot.s, st.nameRowY);
    await this.desktop.sleep(this.timing.afterClick * 2);
    this.lastMaskIndex = index;
    this.log("select-mask", { index, row: Math.round(st.nameRowY) });
    return st;
  }

  /** ⊕ (add) or ⊖ (subtract) each shape into the selected mask. */
  async editShapes(mode: "add" | "sub", shapes: Shape[]): Promise<Overlay | null> {
    let last: Overlay | null = null;
    for (const shape of shapes) {
      let shot = await this.snap();
      if (!this.mon) await this.monitor();
      let ab = findAddSub(shot, this.mon!);
      this.log("find-add-subtract", { found: ab.found });
      if (!ab.found) {
        // ⊕/⊖ show only while the Object Mask tool is active (live 05.11: after a timeline click the
        // selection tool is active and a selected mask row shows no buttons) — activate it, re-select
        // the mask, look again
        const tool = findTool(shot);
        this.log("activate-tool", { found: tool.found, score: tool.score });
        if (tool.found) {
          await this.desktop.click(tool.x, tool.y);
          await this.desktop.sleep(this.timing.afterClick);
          if (this.lastMaskIndex !== null) await this.selectMask(this.lastMaskIndex);
          shot = await this.snap();
          ab = findAddSub(shot, this.mon!);
          this.log("find-add-subtract", { found: ab.found });
        }
      }
      if (!ab.found) this.fail("⊕/⊖ buttons not found under the monitor — the mask is not selected (pass mask_index to select it first) or the Object Mask tool is not active");
      const btn = mode === "add" ? ab.add! : ab.sub!;
      await this.desktop.click(btn.x, btn.y);
      await this.desktop.sleep(this.timing.afterClick);
      await this.applyShape(shape);
      last = await this.overlay();
      this.log(mode === "add" ? "add" : "subtract", { shape: shape.kind, areaFrac: last.areaFrac });
    }
    return last;
  }

  async overlay(): Promise<Overlay> {
    if (!this.frame) this.fail("frame_path is required to measure the mask");
    const shot = await this.snap();
    if (!this.mon) await this.monitor();
    return measureOverlay(shot, this.frame.rgb, this.mon!);
  }

  /**
   * Create a mask on effect row `effectIndex`: select the row, the Object Mask tool (icon or Cmd+Opt+O),
   * then the first shape; returns the new mask's strip (its index among visible masks).
   */
  async create(effectIndex: number, first: Shape, toolShortcut: boolean): Promise<{ strip: Strip; stripIndex: number; overlay: Overlay }> {
    const shot = await this.snap();
    await this.monitor();
    const fx = findFx(shot);
    this.log("find-effect-rows", { rows: fx.rows.length });
    if (!fx.found || effectIndex >= fx.rows.length) this.fail(`effect row ${effectIndex} not found (rows: ${fx.rows.length}) — select the clip so Effect Controls shows it`);
    const row = fx.rows[effectIndex];
    const before = findStrips(shot).length;
    await this.desktop.click(row.x + EFFECT_ROW_DX * shot.s, row.y);
    await this.desktop.sleep(this.timing.afterClick);
    if (toolShortcut) {
      await this.desktop.key("cmd+alt+o");
    } else {
      const tool = findTool(shot);
      this.log("find-tool", { found: tool.found, score: tool.score });
      if (!tool.found) this.fail("Object Mask tool icon not found in the toolbar — show the Tools panel or pass tool_shortcut: true");
      await this.desktop.click(tool.x, tool.y);
    }
    await this.desktop.sleep(this.timing.afterClick);
    await this.applyShape(first);
    const after = await this.snap();
    const fx2 = findFx(after);
    const rowY = fx2.rows[effectIndex]?.y ?? row.y;
    const nextY = fx2.rows[effectIndex + 1]?.y ?? Infinity;
    const all = findStrips(after);
    const under = all.filter((st) => st.y > rowY && st.y < nextY);
    this.log("find-mask-row", { masksBefore: before, masksNow: all.length, underEffect: under.length });
    if (!under.length) this.fail("no mask row appeared under the effect — the click or lasso missed (the first use downloads the models: see the Progress panel)");
    const strip = under[under.length - 1];
    const overlay = measureOverlay(after, this.frame!.rgb, this.mon!);
    this.log("created", { by: first.kind, areaFrac: overlay.areaFrac });
    return { strip, stripIndex: all.indexOf(strip), overlay };
  }

  async setParams(strip: Strip, p: { feather?: number; expansion?: number; inverted?: boolean }): Promise<Record<string, unknown>> {
    const done: Record<string, unknown> = {};
    // A click on the value enters text editing with the whole value selected; typing replaces it.
    // No Cmd+A: Premiere takes it as Select All and the field stops receiving the typed keys.
    const setValue = async (pt: Point, v: number): Promise<void> => {
      await this.desktop.click(pt.x, pt.y);
      await this.desktop.sleep(Math.round(this.timing.afterClick * 1.5));
      await this.desktop.type(String(v));
      await this.desktop.sleep(Math.round(this.timing.afterClick / 2));
      await this.desktop.key("return");
      await this.desktop.sleep(this.timing.afterClick);
    };
    // whole numbers: the decimal separator Premiere accepts depends on its UI language
    if (p.feather !== undefined) { done.feather = Math.round(p.feather); await setValue(strip.rows.feather, done.feather as number); }
    if (p.expansion !== undefined) { done.expansion = Math.round(p.expansion); await setValue(strip.rows.expansion, done.expansion as number); }
    if (p.inverted !== undefined) {
      const shot = await this.snap();
      const c = strip.rows.inverted;
      const on = checkboxChecked(shot, c);
      if (on !== p.inverted) {
        await this.desktop.click(c.x, c.y);
        await this.desktop.sleep(this.timing.afterClick);
      }
      done.inverted = p.inverted;
    }
    this.log("mask-params", done);
    return done;
  }

  /** Press the strip's track button and wait for the progress bar to come and go. */
  async track(strip: Strip, direction: "forward" | "both" | "backward", timeoutMs: number): Promise<{ done: boolean; seconds: number }> {
    const btn = strip.buttons[direction === "backward" ? "back" : direction];
    await this.desktop.click(btn.x, btn.y);
    await this.desktop.sleep(this.timing.poll);
    const s = this.shot?.s ?? 1;
    const region = { x: strip.x - 200 * s, y: strip.y - 400 * s, w: 700 * s, h: 900 * s };
    const t0 = Date.now();
    let seen = false, calm = 0;
    while (Date.now() - t0 < timeoutMs) {
      const shot = await this.snap();
      if (progressVisible(shot, region)) { seen = true; calm = 0; } else {
        calm++;
        if ((seen && calm >= 2) || (!seen && calm >= 5)) {
          const res = { done: true, seconds: Math.round((Date.now() - t0) / 100) / 10 };
          this.log("track", { direction, ...res, progressSeen: seen });
          return res;
        }
      }
      await this.desktop.sleep(this.timing.poll);
    }
    const res = { done: false, seconds: Math.round((Date.now() - t0) / 100) / 10 };
    this.log("track", { direction, ...res, progressSeen: seen });
    return res;
  }
}
