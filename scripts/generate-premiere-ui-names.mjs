#!/usr/bin/env node
/**
 * Regenerates src/locale/premiere-ui-names.generated.ts — the fallback translations
 * of the Premiere UI names the tools themselves use (components, parameters,
 * effects, transitions), read from the ZString dictionaries an installed Premiere
 * ships for all its UI languages. The runtime translates any other name through
 * the installed dictionaries (src/locale/premiere-ui-names.ts); this table only
 * keeps the built-in tools working where the dictionaries cannot be found.
 *
 *   node scripts/generate-premiere-ui-names.mjs [<Premiere>/Contents/Dictionaries]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NAMES = [
  // intrinsic components and their parameters
  "Motion", "Opacity", "Time Remapping", "Volume", "Channel Volume", "Panner",
  "Position", "Scale", "Scale Width", "Scale Height", "Uniform Scale", "Rotation", "Anchor Point", "Anti-flicker Filter",
  "Crop Left", "Crop Top", "Crop Right", "Crop Bottom", "Blend Mode", "Level", "Bypass", "Balance", "Pan", "Speed",
  // a graphic's own layers (built-ins that are never removed)
  "Vector Motion", "Text", "Shape",
  // Lumetri Color sections (color_correct stays inside Basic Correction)
  "Basic Correction", "Creative", "Curves", "Color Wheels & Match", "HSL Secondary", "Vignette",
  // effects the tools apply or inspect
  "Lumetri Color", "Crop", "Warp Stabilizer", "Gaussian Blur", "Transform", "Tint", "Brightness & Contrast", "Ultra Key",
  "Black & White", "Sharpen", "Unsharp Mask", "Directional Blur", "Drop Shadow", "Basic 3D", "Corner Pin", "Track Matte Key",
  "Luma Key", "Color Key", "Noise", "Posterize", "Invert", "Mosaic", "Lens Distortion", "Twirl", "Wave Warp", "Offset",
  "Horizontal Flip", "Vertical Flip", "Edge Feather", "Linear Wipe", "Mirror", "Replicate", "Camera Blur",
  // their parameters
  "Left", "Top", "Right", "Bottom", "Zoom", "Input LUT", "Look", "Exposure", "Contrast", "Highlights", "Shadows", "Whites",
  "Blacks", "Temperature", "Saturation", "Vibrance", "Intensity", "Result", "Smoothness", "Method", "Framing", "Blurriness",
  "Blur Dimensions", "Repeat Edge Pixels", "Amount", "Fill Color", "Tint",
  // transitions
  "Cross Dissolve", "Dip to Black", "Dip to White", "Film Dissolve", "Additive Dissolve", "Morph Cut", "Push", "Slide", "Wipe",
  "Iris Round", "Iris Box", "Iris Cross", "Iris Diamond", "Split", "Barn Doors", "Constant Power", "Constant Gain", "Exponential Fade",
  // audio effects
  "Amplify", "DeEsser", "DeHummer", "Parametric Equalizer", "Hard Limiter", "Dynamics", "Studio Reverb", "Delay",
  "Multiband Compressor", "Loudness Radar", "Pitch Shifter", "Highpass", "Lowpass", "Notch Filter", "Bass", "Treble",
  "Fill Left with Right", "Fill Right with Left", "Swap Channels", "Adaptive Noise Reduction", "DeNoise", "DeReverb",
];

const ENTRY = /^"(\$\$\$\/[^=]+)=(.*)"\s*$/;
const isNameLike = (v) => Boolean(v) && v.length <= 80 && !/[%^@\r\n]|\\[rn]/.test(v);
const keyRank = (k) => (/\/Name$/i.test(k) ? 0 : /Effect|Filter|Transition/i.test(k) ? 1 : /LStr|Param|Label/i.test(k) ? 2 : 3);

function findRoot() {
  if (process.argv[2]) return process.argv[2];
  for (const folder of readdirSync("/Applications").filter((n) => n.startsWith("Adobe Premiere Pro")).sort().reverse()) {
    for (const bundle of readdirSync(join("/Applications", folder)).filter((n) => n.startsWith("Adobe Premiere Pro") && n.endsWith(".app"))) {
      const dir = join("/Applications", folder, bundle, "Contents", "Dictionaries");
      if (existsSync(dir)) return dir;
    }
  }
  throw new Error("Premiere dictionaries not found; pass <Premiere>/Contents/Dictionaries");
}

function entries(dir) {
  const map = new Map();
  for (const file of readdirSync(dir).filter((n) => /\.(dat|dict)$/i.test(n)).sort()) {
    let text = readFileSync(join(dir, file), "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    for (const line of text.split(/\r?\n/)) {
      const m = line.startsWith('"$$$/') ? ENTRY.exec(line) : null;
      // a key can carry different values in different files of one locale
      // (Premiere's own dictionary vs the After Effects one) — keep them all
      if (m) {
        if (!map.has(m[1])) map.set(m[1], []);
        if (!map.get(m[1]).includes(m[2])) map.get(m[1]).push(m[2]);
      }
    }
  }
  return map;
}

const root = findRoot();
const locales = readdirSync(root).filter((n) => /^[a-z]{2}_[A-Z]{2}$/.test(n) && n !== "en_US").sort();
const en = entries(join(root, "en_US"));
const byValue = new Map();
for (const [key, values] of en) {
  for (const value of values) {
    if (!isNameLike(value)) continue;
    if (!byValue.has(value)) byValue.set(value, []);
    if (!byValue.get(value).includes(key)) byValue.get(value).push(key);
  }
}
const localized = Object.fromEntries(locales.map((loc) => [loc, entries(join(root, loc))]));
const table = {};
const missing = [];
for (const name of NAMES) {
  const keys = [...(byValue.get(name) ?? [])].sort((a, b) => keyRank(a) - keyRank(b));
  if (!keys.length) { missing.push(name); continue; }
  const row = {};
  for (const loc of locales) {
    const values = [];
    for (const key of keys) {
      for (const v of localized[loc].get(key) ?? []) {
        if (isNameLike(v) && v !== name && !values.includes(v)) values.push(v);
      }
    }
    if (values.length) row[loc] = values;
  }
  if (Object.keys(row).length) table[name] = row;
}

const version = (() => {
  try {
    const plist = readFileSync(join(root, "..", "Info.plist"), "utf8");
    return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] ?? "unknown";
  } catch { return "unknown"; }
})();

const out = `// GENERATED by scripts/generate-premiere-ui-names.mjs from the ZString dictionaries
// of Premiere Pro ${version} (${locales.length + 1} UI languages). Do not edit by hand.
// Fallback for the names the tools use when no Premiere dictionaries are found at
// runtime; see src/locale/premiere-ui-names.ts.
export const PREMIERE_UI_NAMES_FALLBACK: Record<string, Record<string, string[]>> = ${JSON.stringify(table, null, 2)};
`;
const target = fileURLToPath(new URL("../src/locale/premiere-ui-names.generated.ts", import.meta.url));
writeFileSync(target, out);
console.log(`wrote ${Object.keys(table).length} names × ${locales.length} locales to ${target}`);
if (missing.length) console.log(`not in the en_US dictionary: ${missing.join(", ")}`);
