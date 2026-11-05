// Time Remapping (speed keyframes) in Premiere Pro through its UI — scripting cannot reach it: ExtendScript
// and QE only read a clip's constant speed, UXP has no Time Remapping component. Finders on a window capture
// and the closed-loop actions that add speed keyframes and place them. Facts from live runs on Premiere 26.5
// (macOS, 4K at 1:1):
//  - Effect Controls › Time Remapping › Speed: «◀ ◇ ▶» — the ◇ adds a speed keyframe at the playhead (◆ filled
//    when one is under the playhead); the Speed value cannot be typed;
//  - a clip whose timeline fx badge (right-click → Time Remapping › Speed) shows Speed draws a light keyframe
//    strip with an hourglass handle per speed keyframe and a dotted line under it;
//  - Shift-drag of a handle left/right changes the speed of the segment to its LEFT; after ~3 px the keyframe
//    follows the mouse 1:1 and keyframes to the right ride along; positions are not frame-quantized;
//  - Premiere reads the mouse deltas of these drags, not the positions (events carry their delta fields);
//  - "=" / "-" zoom the focused timeline around the playhead (×1.5–2 per step, with a maximum), "\" fits the
//    sequence; the playhead is a 1 px line of rgb(64,150,243).
import { type GrayImage, type RgbImage, cropGray, cropRgb } from "./image.js";
import { type PointerDesktop } from "./mac.js";
import { type Hit, findTemplate, nccAt } from "./match.js";
import { type Point, type Shot, type Step, ROW_PITCH, findFx, makeShot, template } from "./object-mask.js";
import { type UiTemplateName } from "./templates.js";

// ---------------------------------------------------------------------------------------------- finders

const lumAt = (img: RgbImage, x: number, y: number): number => {
  const i = (y * img.w + x) * 3;
  return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
};

function stripLight(img: RgbImage, x: number, y: number): boolean {
  const i = (y * img.w + x) * 3, r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
  const mn = Math.min(r, g, b);
  return mn >= 205 && Math.max(r, g, b) - mn <= 14;
}

function playheadBlue(img: RgbImage, x: number, y: number): boolean {
  const i = (y * img.w + x) * 3, r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
  return b >= 200 && b - r >= 120 && g >= 110 && g <= 185;
}

/** Columns crossed by a vertical playhead-blue line at least 60 pt long (the playhead, panel frames). */
export function playheadColumns(img: RgbImage, s: number): number[] {
  const minRun = Math.round(60 * s), out: number[] = [];
  for (let x = 0; x < img.w; x++) {
    let run = 0, best = 0;
    for (let y = 0; y < img.h && best < minRun; y++) {
      if (playheadBlue(img, x, y)) { if (++run > best) best = run; } else run = 0;
    }
    if (best >= minRun) out.push(x);
  }
  // a line 2 px wide (Retina) is one column
  return out.filter((x, i) => i === 0 || out[i - 1] !== x - 1);
}

/** Light keyframe-strip bands (rows y0..y1) on both sides of a column. */
function stripBandsAt(img: RgbImage, col: number, s: number): [number, number][] {
  const offs: number[] = [];
  for (let d = Math.round(2 * s); d <= Math.round(14 * s); d++) offs.push(-d, d);
  const bands: [number, number][] = [];
  let start = -1;
  for (let y = 0; y <= img.h; y++) {
    let on = false;
    if (y < img.h) {
      let n = 0, m = 0;
      for (const o of offs) {
        const x = col + o;
        if (x < 0 || x >= img.w) continue;
        m++;
        if (stripLight(img, x, y)) n++;
      }
      on = m > 0 && n >= 0.5 * m;
    }
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      const h = y - start;
      if (h >= 6 * s && h <= 16 * s) bands.push([start, y - 1]);
      start = -1;
    }
  }
  return bands;
}

/** The clip around a strip: walk left and right to the first column that is dark over the strip's rows. */
export function stripExtent(img: RgbImage, col: number, y0: number, y1: number): [number, number] {
  const h = y1 - y0 + 1;
  const dark = (x: number): boolean => {
    let n = 0;
    for (let y = y0; y <= y1; y++) if (lumAt(img, x, y) < 50) n++;
    return n >= 0.8 * h;
  };
  let L = col, R = col;
  while (L > 0 && !dark(L - 1)) L--;
  while (R < img.w - 1 && !dark(R + 1)) R++;
  return [L, R];
}

export interface KeyStrip {
  /** rows of the light strip */
  y0: number;
  y1: number;
  /** the clip's interior on screen (cut by the panel edge when the clip runs past it) */
  x0: number;
  x1: number;
  /** the timeline playhead's column */
  playheadX: number;
  /** a selected clip (light border above the strip) */
  selected: boolean;
}

/** A selected clip has a light 2 pt border 10–24 pt above its strip. */
function selectedAbove(img: RgbImage, x0: number, x1: number, y0: number, s: number): boolean {
  const xs = [x0 + Math.round(4 * s), Math.round((x0 + x1) / 2), x1 - Math.round(4 * s)].filter((x) => x >= 0 && x < img.w);
  for (let y = Math.max(0, y0 - Math.round(24 * s)); y < y0 - Math.round(8 * s); y++) {
    if (xs.every((x) => lumAt(img, x, y) >= 225)) return true;
  }
  return false;
}

/** The speed-keyframe strip the timeline playhead crosses (the selected clip's first). */
export function findKeyStrip(shot: Shot, only?: number): KeyStrip | null {
  const img = shot.cap.img, s = shot.s;
  const found: KeyStrip[] = [];
  for (const col of only === undefined ? playheadColumns(img, s) : [only]) {
    for (const [y0, y1] of stripBandsAt(img, col, s)) {
      const [x0, x1] = stripExtent(img, col, y0, y1);
      if (x1 - x0 < 20 * s) continue;
      found.push({ y0, y1, x0, x1, playheadX: col, selected: selectedAbove(img, x0, x1, y0, s) });
    }
  }
  found.sort((a, b) => Number(b.selected) - Number(a.selected) || a.y0 - b.y0);
  return found[0] ?? null;
}

/** A dotted vertical line (period ≈ 4 pt) under the strip at column c ± 2 pt; the playhead line may cover one column. */
function dottedBelow(img: RgbImage, c: number, st: KeyStrip, s: number): boolean {
  const yA = st.y1 + 1, yB = Math.min(img.h - 1, st.y1 + Math.round(18 * s));
  for (let dx = -Math.round(2 * s); dx <= Math.round(2 * s); dx++) {
    const x = Math.round(c) + dx;
    if (x < 0 || x >= img.w || playheadBlue(img, x, yA + 2)) continue;
    let t = 0;
    for (let y = yA; y < yB; y++) if (Math.abs(lumAt(img, x, y + 1) - lumAt(img, x, y)) > 25) t++;
    if (t >= 5) return true;
  }
  return false;
}

/** Centres of the speed-keyframe handles in a strip (between x0 and x1), left to right. */
export function keyHandles(shot: Shot, st: KeyStrip, x0 = st.x0, x1 = st.x1): number[] {
  const img = shot.cap.img, s = shot.s, y = st.y0 + Math.max(1, Math.round(s));
  const gap = Math.max(1, Math.round(s));
  const runs: [number, number][] = [];
  let a = -1;
  for (let x = Math.max(0, x0); x <= Math.min(img.w - 1, x1) + 1; x++) {
    const dark = x <= Math.min(img.w - 1, x1) && !stripLight(img, x, y);
    if (dark && a < 0) a = x;
    if (!dark && a >= 0) {
      const last = runs[runs.length - 1];
      if (last && a - last[1] - 1 <= gap) last[1] = x - 1;
      else runs.push([a, x - 1]);
      a = -1;
    }
  }
  return runs
    .filter(([p, q]) => q - p + 1 >= 6 * s && q - p + 1 <= 14 * s)
    .map(([p, q]) => (p + q) / 2)
    .filter((c) => dottedBelow(img, c, st, s));
}

function findIn(shot: Shot, name: UiTemplateName, r: { x: number; y: number; w: number; h: number }, minScore: number): Hit[] {
  const t = template(name, shot.s);
  const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
  const w = Math.min(shot.gray.w - x, Math.ceil(r.w)), h = Math.min(shot.gray.h - y, Math.ceil(r.h));
  if (w < t.w || h < t.h) return [];
  const crop: GrayImage = cropGray(shot.gray, x, y, w, h);
  return findTemplate(crop, null, 1, t, minScore, Math.round(6 * shot.s)).map((hit) => ({ ...hit, x: hit.x + x, y: hit.y + y }));
}

export interface SpeedNav {
  found: boolean;
  /** the ◇ / ◆ button */
  diamond?: Point;
  /** ◆: a speed keyframe is under the playhead */
  filled?: boolean;
  header?: Point;
  /** the ˅ / › left of the Time Remapping header */
  disclosure?: Point;
  reason?: string;
}

/** Effect Controls › Time Remapping › Speed: the «◀ ◇ ▶» navigator one row under the third fx header. */
export function findSpeedNav(shot: Shot): SpeedNav {
  const fx = findFx(shot), s = shot.s;
  if (fx.rows.length < 3) {
    return { found: false, reason: `Effect Controls shows ${fx.rows.length} effect header(s); Time Remapping (the third, after Motion and Opacity) is not visible — select the clip, and make room in Effect Controls (collapse Motion / masks or enlarge the panel)` };
  }
  const header = fx.rows[2], disclosure = { x: header.x - 16 * s, y: header.y };
  const hits = findIn(shot, "keynav", { x: header.x, y: header.y + 0.3 * ROW_PITCH * s, w: 900 * s, h: 1.7 * ROW_PITCH * s }, 0.55);
  if (!hits.length) return { found: false, header, disclosure, reason: "Time Remapping › Speed shows no keyframe navigator «◀ ◇ ▶» (section collapsed or Speed not keyframable)" };
  const h = hits[0];
  // the ◇ / ◆ itself: its distance from the arrows depends on the panel's width
  const band = { x: h.x + 8 * s, y: h.y - 2 * s, w: 36 * s, h: 20 * s };
  const hollow = findIn(shot, "keydiamond", band, 0.5)[0], filledHit = findIn(shot, "keydiamondFilled", band, 0.5)[0];
  const best = !hollow ? filledHit : !filledHit ? hollow : filledHit.score > hollow.score ? filledHit : hollow;
  const diamond = best ? { x: best.x + 6.5 * s, y: best.y + 6.5 * s } : { x: h.x + 23.5 * s, y: h.y + 7.5 * s };
  // ◆ is blue inside; ◇ is grey (dark, or lighter while the mouse hovers it)
  const img = shot.cap.img, r = Math.max(1, Math.round(s));
  let blue = 0, n = 0;
  for (let y = Math.round(diamond.y) - r; y <= Math.round(diamond.y) + r; y++) {
    for (let x = Math.round(diamond.x) - r; x <= Math.round(diamond.x) + r; x++) {
      const i = (y * img.w + x) * 3;
      if (img.data[i + 2] - img.data[i] > 40 && img.data[i + 2] > 120) blue++;
      n++;
    }
  }
  return { found: true, diamond, filled: blue >= n / 2, header, disclosure };
}

export interface ClipBox {
  /** first rows of the light top and bottom borders of the selected clip */
  top: number;
  bottom: number;
  /** its left and right ends on screen */
  left: number;
  right: number;
  /** the clip runs past the panel edge there (no vertical border) */
  cutLeft: boolean;
  cutRight: boolean;
  /** a column inside the clip next to the playhead */
  probeX: number;
}

/** Vertical runs of light pixels (a selected clip's 2 pt border) in one column. */
function lightRuns(img: RgbImage, x: number, s: number): number[] {
  const out: number[] = [];
  let a = -1;
  for (let y = 0; y <= img.h; y++) {
    const on = y < img.h && lumAt(img, x, y) >= 225;
    if (on && a < 0) a = y;
    if (!on && a >= 0) {
      const n = y - a;
      if (n >= Math.max(1, 2 * s - 1) && n <= 3 * s + 1) out.push(a);
      a = -1;
    }
  }
  return out;
}

/**
 * The selected clip the timeline playhead crosses: light 2 pt borders above and below, followed along the
 * top border to both ends (the playhead line may cross it). Works for a clip a few pixels wide.
 */
export function findClipBox(shot: Shot, only?: number): ClipBox | null {
  const img = shot.cap.img, s = shot.s;
  const light = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < img.w && y < img.h && lumAt(img, x, y) >= 225;
  const boxes: ClipBox[] = [];
  for (const col of only === undefined ? playheadColumns(img, s) : [only]) {
    for (const off of [2, -2, 5, -5, 9, -9]) {
      const x = col + Math.round(off * s);
      if (x < 0 || x >= img.w) continue;
      const runs = lightRuns(img, x, s);
      for (let i = 0; i + 1 < runs.length; i++) {
        const top = runs[i], bottom = runs[i + 1];
        if (bottom - top < 20 * s || bottom - top > 400 * s) continue;
        const gap = Math.round(2 * s) + 1;
        const walk = (dir: number): number => {
          let end = x, miss = 0;
          for (let xx = x + dir; xx >= 0 && xx < img.w; xx += dir) {
            if (light(xx, top)) { end = xx; miss = 0; } else if (++miss > gap) break;
          }
          return end;
        };
        const left = walk(-1), right = walk(1);
        const rows = Math.max(3, Math.min(bottom - top, Math.round(12 * s)));
        const vertical = (xe: number): boolean => {
          for (const xx of [xe, xe - 1, xe + 1]) {
            let n = 0;
            for (let y = top; y < top + rows; y++) if (light(xx, y)) n++;
            if (n >= 0.8 * rows) return true;
          }
          return false;
        };
        boxes.push({ top, bottom, left, right, cutLeft: !vertical(left), cutRight: !vertical(right), probeX: x });
      }
      if (boxes.length) break;
    }
    if (boxes.length) break;
  }
  return boxes[0] ?? null;
}

/** Where to click to select the clip and focus the timeline: its name row, beside the playhead line. */
export function clipFocusPoint(box: ClipBox, s: number): Point {
  return { x: box.probeX, y: box.top + Math.round(6 * s) };
}

/** The fx badge in the clip's top-right corner (template; fallback: the measured offset). */
export function timelineFxBadge(shot: Shot, box: ClipBox): Point {
  const s = shot.s;
  const hits = findIn(shot, "tlfx", { x: box.right - 44 * s, y: box.top, w: 44 * s, h: 22 * s }, 0.5);
  if (hits.length) return { x: hits[0].x + 8 * s, y: hits[0].y + 6 * s };
  return { x: box.right - 13 * s, y: box.top + 8.5 * s };
}

export interface Ruler { x: number; y: number; w: number; rulerY: number; score: number }

/** The Timeline panel's toolbar; its time ruler — where the playhead head is — lies 26 pt below the toolbar's top. */
export function findTimelineRuler(shot: Shot, hint?: Ruler | null): Ruler | null {
  const s = shot.s, t = template("tltools", s);
  if (hint) {
    const sc = nccAt(shot.gray, t, hint.x, hint.y);
    if (sc >= 0.8) return { ...hint, score: sc };
  }
  const { corr, k } = shot.coarse();
  const hits = findTemplate(shot.gray, corr, k, t, 0.7, Math.round(40 * s));
  if (!hits.length) return null;
  const h = hits[0];
  return { x: h.x, y: h.y, w: t.w, rulerY: h.y + Math.round(26 * s), score: h.score };
}

/** The timeline playhead: a long playhead-blue line whose head (wider) is on the ruler row, right of the toolbar. */
export function timelineHeadX(shot: Shot, ruler: Ruler): number | null {
  const img = shot.cap.img, s = shot.s;
  for (const col of playheadColumns(img, s)) {
    if (col <= ruler.x + ruler.w) continue;
    let n = 0;
    for (let dx = -Math.round(3 * s); dx <= Math.round(3 * s); dx++) {
      const x = col + dx;
      if (x >= 0 && x < img.w && playheadBlue(img, x, ruler.rulerY)) n++;
    }
    // the head is half hidden at the ruler's start (time 0)
    if (n >= Math.round(4 * s)) return col;
  }
  return null;
}

/** Pixels whose gray level differs by more than 8 between two captures, inside a rectangle (captures carry no noise). */
export function changedPixels(a: Shot, b: Shot, r: { x: number; y: number; w: number; h: number }): number {
  if (a.gray.w !== b.gray.w || a.gray.h !== b.gray.h) return Infinity;
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(a.gray.w, Math.ceil(r.x + r.w)), y1 = Math.min(a.gray.h, Math.ceil(r.y + r.h));
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * a.gray.w + x;
      if (Math.abs(a.gray.data[i] - b.gray.data[i]) > 8) n++;
    }
  }
  return n;
}

/** A menu's highlighted item: a horizontal run (≥ 40 pt) of highlight blue inside the rectangle. */
export function menuHighlight(shot: Shot, r: { x: number; y: number; w: number; h: number }): { x0: number; x1: number; y: number } | null {
  const img = shot.cap.img, s = shot.s;
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.w, Math.ceil(r.x + r.w)), y1 = Math.min(img.h, Math.ceil(r.y + r.h));
  let best: { x0: number; x1: number; y: number; n: number } | null = null;
  for (let y = y0; y < y1; y++) {
    let run = 0, start = 0;
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.w + x) * 3;
      const on = x < x1 && img.data[i + 2] >= 150 && img.data[i + 2] - img.data[i] >= 90 && img.data[i + 1] >= 60 && img.data[i + 1] <= 140;
      if (on) { if (!run) start = x; run++; }
      else if (run) {
        if (run >= 40 * s && (!best || run > best.n)) best = { x0: start, x1: x - 1, y, n: run };
        run = 0;
      }
    }
  }
  if (!best) return null;
  // the bar is ~20 pt tall: its middle row
  let top = best.y, bottom = best.y;
  const blueAt = (x: number, y: number): boolean => { const i = (y * img.w + x) * 3; return img.data[i + 2] >= 150 && img.data[i + 2] - img.data[i] >= 90; };
  const mx = Math.round((best.x0 + best.x1) / 2);
  while (top > y0 && blueAt(mx, top - 1)) top--;
  while (bottom < y1 - 1 && blueAt(mx, bottom + 1)) bottom++;
  return { x0: best.x0, x1: best.x1, y: (top + bottom) / 2 };
}

// ---------------------------------------------------------------------------------------------- planning

export interface ClipInfo {
  name: string;
  start: number;
  end: number;
  inPoint: number;
  outPoint: number;
  speed: number;
  reversed: boolean;
  /** seconds per sequence frame */
  frame: number;
  /** start of the next clip on the same track, or null */
  nextStart: number | null;
}

export interface RemapPoint {
  /** media time of the frame (seconds) */
  source: number;
  /** sequence time where that frame should play (seconds) */
  sequence: number;
}

export interface PlannedKey {
  /** media time the keyframe marks (snapped to the sequence frame it is added on) */
  source: number;
  /** where the keyframe is added (the frame showing `source` at 100 %) */
  initial: number;
  /** where it is dragged to */
  target: number;
  /** speed of the segment to its left, 1 = 100 % */
  speedLeft: number;
}

export class RemapPlanError extends Error {}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Keyframes and speeds for points «media frame → sequence time» on a clip at 100 %. */
export function planRemap(info: ClipInfo, points: RemapPoint[], limits = { min: 0.1, max: 10 }): PlannedKey[] {
  const f = info.frame;
  if (!(f > 0)) throw new RemapPlanError("the sequence frame duration is unreadable");
  if (info.reversed) throw new RemapPlanError("the clip plays reversed; set it forward first (Clip › Speed/Duration)");
  if (Math.abs(info.speed - 1) > 1e-6) throw new RemapPlanError(`the clip runs at ${round6(info.speed * 100)} %; set it to 100 % first (Clip › Speed/Duration) — keyframes are placed from the 100 % mapping`);
  if (!points.length) throw new RemapPlanError("give at least one point");
  const snap = (t: number): number => Math.round(t / f) * f;
  const out: PlannedKey[] = [];
  let prevS = info.inPoint, prevQ = info.start;
  points.forEach((p, i) => {
    const initial = snap(info.start + (p.source - info.inPoint));
    const source = info.inPoint + (initial - info.start);
    const target = snap(p.sequence);
    if (source < info.inPoint + f - 1e-9 || source > info.outPoint - f + 1e-9) {
      throw new RemapPlanError(`point ${i}: source ${p.source}s is not inside the clip's media range (${round6(info.inPoint + f)}…${round6(info.outPoint - f)}s)`);
    }
    if (source <= prevS + f / 2) throw new RemapPlanError(`point ${i}: source times must increase by at least one frame`);
    if (target <= prevQ + f / 2) throw new RemapPlanError(`point ${i}: sequence times must increase by at least one frame${i === 0 ? " and come after the clip start" : ""}`);
    const speedLeft = (source - prevS) / (target - prevQ);
    if (speedLeft < limits.min || speedLeft > limits.max) {
      throw new RemapPlanError(`point ${i}: the segment to its left would run at ${round6(speedLeft * 100)} % (allowed ${limits.min * 100}–${limits.max * 100} %)`);
    }
    // the clip end while the keyframes are placed left to right (the rest still at 100 %)
    const endThen = target + (info.end - initial);
    if (info.nextStart !== null && endThen > info.nextStart + f / 2) {
      throw new RemapPlanError(`point ${i}: the clip would run to ${round6(endThen)}s, into the next clip on its track at ${round6(info.nextStart)}s — make room first`);
    }
    out.push({ source: round6(source), initial: round6(initial), target: round6(target), speedLeft });
    prevS = source;
    prevQ = target;
  });
  return out;
}

// ---------------------------------------------------------------------------------------------- actions

/** What the actions need from Premiere's scripting side. */
export interface RemapBridge {
  clip(): Promise<ClipInfo>;
  selectOnly(): Promise<void>;
  /** set the playhead (frame-snapped) and return where it is */
  setPlayhead(seconds: number): Promise<number>;
  getPlayhead(): Promise<number>;
  undoIndex(): Promise<number | null>;
}

export class RemapUiError extends Error {
  constructor(message: string, readonly steps: Step[], readonly mutated: boolean) {
    super(message);
  }
}

export interface RemapTiming { afterPlayhead: number; afterClick: number; afterKey: number; afterRelease: number }
export const DEFAULT_REMAP_TIMING: RemapTiming = { afterPlayhead: 250, afterClick: 500, afterKey: 600, afterRelease: 500 };

export interface RemapOptions {
  /** how close each keyframe must end up to its target, in frames */
  toleranceFrames: number;
  /** zoom the timeline to the sequence at the end */
  fitAtEnd: boolean;
}

export interface KeyResult {
  index: number;
  sourceSeconds: number;
  targetSeconds: number;
  speedLeftPercent: number;
  /** measured keyframe − target at the finest zoom, in frames */
  offsetFrames: number;
  pxPerFrame: number;
}

export class TimeRemapUi {
  readonly steps: Step[] = [];
  mutated = false;
  private pps: number | null = null;
  private ppsBeforeZoom: number | null = null;
  private zoomMaxed = false;
  private scale = 1;
  private ruler: Ruler | null = null;
  private lost = 0;

  constructor(
    private readonly d: PointerDesktop,
    private readonly b: RemapBridge,
    private readonly t: RemapTiming = DEFAULT_REMAP_TIMING,
  ) {}

  private fail(message: string): never {
    throw new RemapUiError(message, this.steps, this.mutated);
  }

  async shot(): Promise<Shot> {
    const shot = makeShot(await this.d.capture());
    this.scale = shot.s;
    return shot;
  }

  private async playhead(seconds: number): Promise<number> {
    const at = await this.b.setPlayhead(seconds);
    await this.d.sleep(this.t.afterPlayhead);
    return at;
  }

  /** The Timeline panel's ruler (found once, then checked in place) and where its playhead is. */
  private view(shot: Shot): { ruler: Ruler; head: number | null } {
    const r = findTimelineRuler(shot, this.ruler);
    if (!r) this.fail("The Timeline panel was not found (its toolbar: nest / snap / linked selection / marker / wrench) — show the Timeline panel. Nothing was changed.");
    this.ruler = r;
    return { ruler: r, head: timelineHeadX(shot, r) };
  }

  /** Where the timeline draws the playhead at time t (null: off screen). */
  private async headAt(t: number): Promise<{ at: number; x: number | null; shot: Shot }> {
    const at = await this.playhead(t);
    const shot = await this.shot();
    return { at, x: this.view(shot).head, shot };
  }

  /** A timeline shortcut: a click on the ruler at the playhead gives the timeline focus and leaves the playhead there. */
  private async timelineKey(key: string): Promise<void> {
    const shot = await this.shot();
    const { ruler, head } = this.view(shot);
    await this.d.click(head ?? ruler.x + ruler.w + 120 * this.scale, ruler.rulerY);
    await this.d.sleep(300);
    await this.d.key(key);
    await this.d.sleep(this.t.afterKey);
    if (key === "equal" || key === "minus") {
      this.ppsBeforeZoom = key === "equal" ? this.pps : null;
      this.pps = null;
    }
    this.steps.push({ step: key === "shift+equal" ? "taller_tracks" : key === "v" ? "selection_tool" : "zoom", key });
  }

  /**
   * Zoom with «=» / «-» until the whole clip is on screen and at least ~500 pt wide (or as wide as Premiere's
   * zoom goes), measured by the playhead parked on its first and last frame. Ends with the playhead mid-clip.
   */
  async frameClip(info: ClipInfo): Promise<Shot> {
    // inner frames (a head at the ruler's very start is half hidden); the width is extrapolated to the ends.
    // Parking the playhead off screen scrolls the view: then the head's place mid-clip changes, and the
    // measurement is void — zoom out instead.
    const f = info.frame, dur = info.end - info.start, mid = (info.start + info.end) / 2;
    const ta = dur >= 4 * f ? info.start + f : info.start, tb = dur >= 4 * f ? info.end - 2 * f : Math.max(info.start, info.end - f);
    let lastW = -1, maxedIn = false, zoomedIn = false;
    for (let iter = 0; iter < 24; iter++) {
      const m0 = await this.headAt(mid);
      const a = await this.headAt(ta), m1 = await this.headAt(mid);
      const b = await this.headAt(tb), m2 = await this.headAt(mid);
      const s = this.scale;
      const scrolled = m0.x === null || a.x === null || b.x === null || m1.x !== m0.x || m2.x !== m0.x;
      if (scrolled) {
        await this.timelineKey("minus");
        if (zoomedIn) maxedIn = true;
        continue;
      }
      const w = b.at > a.at ? ((b.x! - a.x!) * dur) / (b.at - a.at) : b.x! - a.x!;
      if (zoomedIn && w <= lastW * 1.05) maxedIn = true;
      if (w < 500 * s && !maxedIn) {
        await this.timelineKey("equal");
        zoomedIn = true;
        lastW = w;
        continue;
      }
      if (b.at > a.at && b.x! > a.x!) this.pps = (b.x! - a.x!) / (b.at - a.at);
      return m2.shot;
    }
    this.fail("Could not zoom the timeline so that the whole clip is in view.");
  }

  /**
   * The fx badge's menu → Time Remapping › Speed. The arrow keys move the highlight (checked on screen: the
   * highlighted item is a blue bar); Return does not pick a menu item from a posted key event, so the
   * highlighted submenu item is clicked. No key goes to the timeline unless the menu is really open.
   */
  private async showSpeed(shot: Shot, box: ClipBox): Promise<void> {
    const s = this.scale;
    const badge = timelineFxBadge(shot, box);
    const area = { x: badge.x - 40 * s, y: badge.y, w: 700 * s, h: 320 * s };
    await this.d.rightClick(badge.x, badge.y);
    await this.d.sleep(this.t.afterKey);
    const menu = await this.shot();
    if (changedPixels(shot, menu, area) < 2000 * s * s) {
      this.fail("Right-clicking the clip's fx badge (top-right corner on the timeline) opened no menu. Show Time Remapping › Speed on the clip by hand (fx badge → Time Remapping → Speed) and retry. Nothing was changed.");
    }
    const closeMenu = async (): Promise<void> => { await this.d.key("escape"); await this.d.sleep(200); await this.d.key("escape"); await this.d.sleep(300); };
    // the third item (Motion, Opacity, Time Remapping are always the first three)
    for (const k of ["down", "down", "down"]) { await this.d.key(k); await this.d.sleep(150); }
    await this.d.sleep(300);
    const third = menuHighlight(await this.shot(), area);
    if (!third) {
      await closeMenu();
      this.fail("The fx badge menu did not move its highlight on the arrow keys. Show Time Remapping › Speed on the clip by hand and retry. Nothing was changed.");
    }
    await this.d.key("right");
    await this.d.sleep(500);
    const sub = menuHighlight(await this.shot(), { x: third.x1 + 2 * s, y: third.y - 30 * s, w: 400 * s, h: 60 * s });
    if (!sub) {
      await closeMenu();
      this.fail("The fx badge menu showed no submenu item on its third item (Time Remapping). Show Time Remapping › Speed on the clip by hand and retry. Nothing was changed.");
    }
    await this.d.click((sub.x0 + sub.x1) / 2, sub.y);
    await this.d.sleep(this.t.afterKey);
    this.steps.push({ step: "show_speed_keyframes", badge, item: { x: Math.round((sub.x0 + sub.x1) / 2), y: Math.round(sub.y) } });
  }

  /** The Selection tool (V): a stray tool (Pen, Razor …) would turn the clicks on the clip into edits. */
  private async selectionTool(): Promise<void> {
    await this.timelineKey("v");
  }

  /** Frame the clip and make it show its speed keyframes on the timeline. */
  async ensureStrip(info: ClipInfo): Promise<{ shot: Shot; st: KeyStrip }> {
    await this.selectionTool();
    let shot = await this.frameClip(info);
    let head = this.view(shot).head;
    let st = head === null ? null : findKeyStrip(shot, head);
    if (st) return { shot, st };
    const box = head === null ? null : findClipBox(shot, head);
    if (!box) this.fail("The selected clip was not found under the playhead on the timeline (is its track collapsed or locked out of view?). Nothing was changed.");
    await this.showSpeed(shot, box);
    await this.selectionTool();
    for (let taller = 0; taller <= 3; taller++) {
      shot = await this.shot();
      head = this.view(shot).head;
      st = head === null ? null : findKeyStrip(shot, head);
      if (st) return { shot, st };
      if (taller === 3) break;
      // a short track draws no clip keyframes: Shift+= makes the tracks taller
      await this.timelineKey("shift+equal");
    }
    this.fail("The clip shows no speed-keyframe strip on the timeline even with taller tracks. Make the video track taller (double-click its header), check that the timeline's wrench menu shows video keyframes, and retry. Nothing was changed in the project.");
  }

  async addKeys(plan: PlannedKey[]): Promise<void> {
    let expanded = false;
    for (let k = 0; k < plan.length; k++) {
      const at = await this.playhead(plan[k].initial);
      let shot = await this.shot();
      let nav = findSpeedNav(shot);
      if (!nav.found && nav.disclosure && !expanded) {
        expanded = true;
        await this.d.click(nav.disclosure.x, nav.disclosure.y);
        await this.d.sleep(this.t.afterClick);
        shot = await this.shot();
        nav = findSpeedNav(shot);
        this.steps.push({ step: "expand_time_remapping", found: nav.found });
      }
      if (!nav.found || !nav.diamond) this.fail(`${nav.reason ?? "speed keyframe navigator not found"}.${this.mutated ? "" : " Nothing was changed."}`);
      if (nav.filled) this.fail(`A speed keyframe is already under the playhead at ${round6(at)}s.`);
      await this.d.click(nav.diamond.x, nav.diamond.y);
      this.mutated = true;
      await this.d.sleep(this.t.afterClick);
      const check = findSpeedNav(await this.shot());
      this.steps.push({ step: "add_keyframe", index: k, seconds: round6(at), filled: check.filled === true });
      if (!check.filled) this.fail(`Clicked ◇ at ${round6(at)}s but no speed keyframe appeared under the playhead.`);
    }
  }

  /**
   * Pixels per second at the current zoom: the playhead at a second time, then back at the first — when the
   * first position moved, the view scrolled in between and the pair is measured again closer together.
   */
  private async measurePps(target: number, x1: number): Promise<number> {
    let d = this.pps ? Math.min(2, (300 * this.scale) / this.pps) : 1;
    let best: number | null = null;
    for (let tries = 0; tries < 8; tries++) {
      const r = await this.headAt(target - d >= 0 ? target - d : target + d);
      const back = await this.headAt(target);
      if (r.x !== null && back.x !== null && Math.abs(back.x - x1) <= 1 && Math.abs(r.at - back.at) > 0) {
        best = Math.abs(r.x - back.x) / Math.abs(r.at - back.at);
        if (Math.abs(r.x - back.x) >= 120 * this.scale || d >= 2) break;
        d *= 3;
      } else {
        if (best !== null) break;
        if (back.x !== null) x1 = back.x;
        d /= 4;
      }
    }
    if (best === null || !(best > 0)) this.fail("Could not measure the timeline scale (a second playhead position was not on screen).");
    return best;
  }

  /** Shift-drag the handle at x until the keyframe sits on the playhead column. */
  private async dragKey(x: number, st: KeyStrip, errPx: number, tolPx: number): Promise<number> {
    const s = this.scale, y = Math.round((st.y0 + st.y1) / 2);
    await this.d.mouseDown(Math.round(x), y, ["shift"]);
    let cur = x, remaining = errPx, moved = 0;
    try {
      for (let k = 0; k < 8 && Math.abs(remaining) > tolPx; k++) {
        const step = Math.abs(remaining) > 60 * s ? Math.max(1, Math.abs(remaining) / 40) : 1;
        await this.d.mouseDragBy(remaining, 0, ["shift"], step);
        moved += remaining;
        const shot = await this.shot();
        const [ex0, ex1] = stripExtent(shot.cap.img, Math.round(cur), st.y0, st.y1);
        const hs = keyHandles(shot, st, ex0, ex1);
        const expect = x + moved;
        const near = hs.length ? hs.reduce((p, q) => (Math.abs(q - expect) < Math.abs(p - expect) ? q : p)) : null;
        if (near === null || Math.abs(near - expect) > Math.max(24 * s, Math.abs(remaining) * 0.5 + 8 * s)) break;
        cur = near;
        remaining = st.playheadX - near;
      }
    } finally {
      await this.d.mouseUp(["shift"]);
    }
    await this.d.sleep(this.t.afterRelease);
    this.steps.push({ step: "shift_drag", from: round6(x), errPx: round6(errPx), remainingPx: round6(remaining) });
    return cur;
  }

  /** Bring keyframe i onto its target: zoom in until a pixel is finer than the tolerance. */
  async placeKey(i: number, plan: PlannedKey[], model: number[], f: number, opts: RemapOptions): Promise<KeyResult> {
    const target = plan[i].target;
    for (let iter = 0; iter < 26; iter++) {
      await this.playhead(target);
      const shot = await this.shot();
      const s = shot.s;
      const head = this.view(shot).head;
      const st = head === null ? null : findKeyStrip(shot, head);
      if (!st) {
        // the view scrolled away from the target: frame the (re-timed) clip again
        if (this.lost++ < 3) {
          await this.frameClip(await this.b.clip());
          continue;
        }
        this.fail(`Lost the clip's speed-keyframe strip while placing keyframe ${i}.`);
      }
      if (this.pps === null) {
        this.pps = await this.measurePps(target, st.playheadX);
        if (this.ppsBeforeZoom !== null && this.pps < this.ppsBeforeZoom * 1.05) this.zoomMaxed = true;
        this.ppsBeforeZoom = null;
        continue;
      }
      const pps = this.pps, ppf = pps * f;
      const expected = st.playheadX + (model[i] - target) * pps;
      const gapL = i > 0 ? (model[i] - model[i - 1]) * pps : Infinity;
      const gapR = i + 1 < model.length ? (model[i + 1] - model[i]) * pps : Infinity;
      const slack = Math.max(6 * s, 0.45 * Math.min(gapL, gapR));
      const hs = keyHandles(shot, st);
      const near = hs.length ? hs.reduce((p, q) => (Math.abs(q - expected) < Math.abs(p - expected) ? q : p)) : null;
      if (near === null || Math.abs(near - expected) > slack) {
        if (expected < st.x0 || expected > st.x1 || Math.abs(expected - st.playheadX) > 1500 * s) {
          await this.timelineKey("minus");
          continue;
        }
        this.fail(`Speed keyframe ${i} was not found near x=${Math.round(expected)} on the timeline (handles at ${hs.map(Math.round).join(", ") || "none"}).`);
      }
      const err = st.playheadX - near;
      const tolPx = Math.max(0.5 * s, opts.toleranceFrames * ppf);
      if (Math.abs(err) <= tolPx) {
        if (opts.toleranceFrames * ppf >= s || this.zoomMaxed) {
          return {
            index: i, sourceSeconds: plan[i].source, targetSeconds: target, speedLeftPercent: round6(plan[i].speedLeft * 100),
            offsetFrames: round6(-err / ppf), pxPerFrame: round6(ppf),
          };
        }
        await this.timelineKey("equal");
        continue;
      }
      if (Math.abs(err) > 1500 * s) {
        await this.timelineKey("minus");
        continue;
      }
      const after = await this.dragKey(near, st, err, tolPx);
      this.mutated = true;
      const delta = (after - near) / pps;
      for (let j = i; j < model.length; j++) model[j] += delta;
    }
    this.fail(`Speed keyframe ${i} did not settle on its target after repeated drags.`);
  }

  /** Where the clip's speed keyframes are, in sequence seconds (measured on screen at the current zoom). */
  async inspect(): Promise<{ shown: boolean; clip: ClipInfo; keyframes: number[]; precisionFrames: number | null; pxPerFrame: number | null; preview?: RgbImage }> {
    const info = await this.b.clip();
    const was = await this.b.getPlayhead();
    await this.b.selectOnly();
    try {
      const shot = await this.frameClip(info);
      const head = this.view(shot).head;
      const st = head === null ? null : findKeyStrip(shot, head);
      if (!st) return { shown: false, clip: info, keyframes: [], precisionFrames: null, pxPerFrame: null };
      const at = await this.b.getPlayhead();
      const pps = await this.measurePps(at, st.playheadX);
      await this.playhead(at);
      const again = await this.shot();
      const h2 = this.view(again).head;
      const st2 = (h2 === null ? null : findKeyStrip(again, h2)) ?? st;
      const hs = keyHandles(again, st2);
      const s = again.s, img = again.cap.img, ppf = pps * info.frame;
      const px0 = Math.max(0, st2.x0 - 40 * s), py0 = Math.max(0, st2.y0 - 30 * s);
      return {
        shown: true, clip: info, keyframes: hs.map((x) => round6(at + (x - st2.playheadX) / pps)),
        precisionFrames: round6((0.5 * s) / ppf), pxPerFrame: round6(ppf),
        preview: cropRgb(img, px0, py0, Math.min(img.w - px0, st2.x1 - st2.x0 + 80 * s), Math.min(img.h - py0, 110 * s)),
      };
    } finally {
      await this.b.setPlayhead(was);
    }
  }

  async run(points: RemapPoint[], opts: RemapOptions): Promise<{
    clip: ClipInfo; plan: PlannedKey[]; keys: KeyResult[]; endSeconds: number; expectedEndSeconds: number;
    handlesAtEnd: number | null; undoIndexBefore: number | null; undoIndexAfter: number | null; preview: RgbImage;
  }> {
    const info = await this.b.clip();
    let plan: PlannedKey[];
    try {
      plan = planRemap(info, points);
    } catch (e) {
      this.fail(`${(e as Error).message}. Nothing was changed.`);
    }
    const undoIndexBefore = await this.b.undoIndex();
    await this.b.selectOnly();
    this.steps.push({ step: "select", clip: info.name });
    const first = await this.ensureStrip(info);
    let shot = first.shot;
    let st: KeyStrip = first.st;
    // the whole clip is in view: no speed keyframes on it yet
    const existing = keyHandles(shot, st);
    if (existing.length) this.fail(`The clip already has ${existing.length} speed keyframe(s). Remove them first (Effect Controls › Time Remapping › Speed: click the stopwatch off, or undo), then retry. Nothing was changed.`);
    await this.addKeys(plan);
    const model = plan.map((k) => k.initial);
    const keys: KeyResult[] = [];
    for (let i = 0; i < plan.length; i++) keys.push(await this.placeKey(i, plan, model, info.frame, opts));
    const after = await this.b.clip();
    const last = plan[plan.length - 1];
    const expectedEnd = round6(last.target + (info.end - last.initial));
    let handlesAtEnd: number | null = null;
    if (opts.fitAtEnd) {
      // the whole re-timed clip in view again: every keyframe, and no stray one
      shot = await this.frameClip(after);
      const head = this.view(shot).head;
      const fin = head === null ? null : findKeyStrip(shot, head);
      if (fin) {
        st = fin;
        handlesAtEnd = keyHandles(shot, fin).length;
      }
    } else {
      shot = await this.shot();
    }
    const s = shot.s, img = shot.cap.img;
    const px0 = Math.max(0, st.x0 - 40 * s), py0 = Math.max(0, st.y0 - 30 * s);
    const preview = cropRgb(img, px0, py0, Math.min(img.w - px0, st.x1 - st.x0 + 80 * s), Math.min(img.h - py0, 110 * s));
    return {
      clip: info, plan, keys, endSeconds: round6(after.end), expectedEndSeconds: expectedEnd, handlesAtEnd,
      undoIndexBefore, undoIndexAfter: await this.b.undoIndex(), preview,
    };
  }
}
