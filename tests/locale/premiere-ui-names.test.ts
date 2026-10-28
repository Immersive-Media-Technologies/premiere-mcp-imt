import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  buildPremiereDictionaryIndex,
  premiereDictionaryIndex,
  premiereDictionaryRoots,
  premiereL10nPrelude,
  premiereUiNameTranslations,
  resetPremiereDictionaryCache,
} from "../../src/locale/premiere-ui-names.js";
import { PREMIERE_UI_NAMES_FALLBACK } from "../../src/locale/premiere-ui-names.generated.js";
import { buildScript, getHelpersSource } from "../../src/bridge/script-builder.js";

const BOM = "﻿";

function writeDictionary(root: string, locale: string, file: string, entries: Record<string, string>): void {
  mkdirSync(join(root, locale), { recursive: true });
  const body = Object.entries(entries).map(([key, value]) => `"${key}=${value}"`).join("\r\n");
  writeFileSync(join(root, locale, file), BOM + "; comment line\r\n" + body + "\r\n");
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "pr-dict-"));
  writeDictionary(root, "en_US", "zdictionary_PPRO_en_US.dat", {
    "$$$/MediaCore/AEFilters/AEGaussianBlur/Name": "Gaussian Blur",
    "$$$/AE/Effect/Name/WarpStabilizer": "Warp Stabilizer",
    "$$$/PPro/Effect/Name/Stabilizer": "Warp Stabilizer",
    "$$$/Dialog/Level": "Level",
    "$$$/Format/Version": "Lumetri Color, v%ld.%ld",
  });
  writeDictionary(root, "ru_RU", "after_effects_ru_RU.dat", {
    "$$$/AE/Effect/Name/WarpStabilizer": "Стабилизатор деформации",
  });
  writeDictionary(root, "ru_RU", "zdictionary_PPRO_ru_RU.dat", {
    "$$$/MediaCore/AEFilters/AEGaussianBlur/Name": "Размытие по Гауссу",
    "$$$/AE/Effect/Name/WarpStabilizer": "Стабил-тор деформ.",
    "$$$/PPro/Effect/Name/Stabilizer": "Стабилизатор деформации",
    "$$$/Dialog/Level": "Уровень",
    "$$$/Format/Version": "Цвет Lumetri, v%ld.%ld",
  });
  writeDictionary(root, "de_DE", "zdictionary_PPRO_de_DE.dat", {
    "$$$/MediaCore/AEFilters/AEGaussianBlur/Name": "Gaußscher Weichzeichner",
    "$$$/Dialog/Level": "Pegel",
  });
  mkdirSync(join(root, "not-a-locale"));
  return root;
}

describe("Premiere UI dictionaries", () => {
  let root: string;
  const saved = process.env.PREMIERE_DICTIONARIES_DIR;
  beforeEach(() => {
    root = fixture();
    process.env.PREMIERE_DICTIONARIES_DIR = root;
    resetPremiereDictionaryCache();
  });
  afterEach(() => {
    process.env.PREMIERE_DICTIONARIES_DIR = saved;
    resetPremiereDictionaryCache();
    rmSync(root, { recursive: true, force: true });
  });

  it("indexes English UI names and every value a key has across one locale's files", () => {
    const index = buildPremiereDictionaryIndex(root);
    expect(index.locales).toEqual(["de_DE", "en_US", "ru_RU"]);
    expect(index.englishKeys.get("Warp Stabilizer")).toHaveLength(2);
    // format strings are never UI names
    expect(index.englishKeys.has("Lumetri Color, v%ld.%ld")).toBe(false);
    expect(index.localized.get("ru_RU")?.get("$$$/AE/Effect/Name/WarpStabilizer")).toEqual(["Стабилизатор деформации", "Стабил-тор деформ."]);
  });

  it("rejects a root without an en_US dictionary", () => {
    const empty = mkdtempSync(join(tmpdir(), "pr-dict-empty-"));
    try {
      expect(() => buildPremiereDictionaryIndex(empty)).toThrow(/en_US/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("translates an English name into every installed UI language, name keys first", () => {
    const t = premiereUiNameTranslations("Warp Stabilizer");
    expect(t?.ru_RU).toEqual(expect.arrayContaining(["Стабилизатор деформации", "Стабил-тор деформ."]));
    expect(premiereUiNameTranslations("Gaussian Blur")?.de_DE?.[0]).toBe("Gaußscher Weichzeichner");
    // case-insensitive spelling of the English name
    expect(premiereUiNameTranslations("gaussian blur")?.ru_RU).toContain("Размытие по Гауссу");
    expect(premiereUiNameTranslations("Level")?.ru_RU).toContain("Уровень");
  });

  it("returns undefined for unknown, empty, non-Latin or overlong names", () => {
    resetPremiereDictionaryCache();
    process.env.PREMIERE_DICTIONARIES_DIR = "off";
    expect(premiereUiNameTranslations("No Such Effect 42")).toBeUndefined();
    expect(premiereUiNameTranslations("")).toBeUndefined();
    expect(premiereUiNameTranslations("Размытие")).toBeUndefined();
    expect(premiereUiNameTranslations("x".repeat(81))).toBeUndefined();
  });

  it("falls back to the generated table when no dictionaries are installed", () => {
    process.env.PREMIERE_DICTIONARIES_DIR = "off";
    resetPremiereDictionaryCache();
    expect(premiereDictionaryIndex()).toBeNull();
    expect(premiereUiNameTranslations("Lumetri Color")?.ru_RU).toContain("Цвет Lumetri");
    expect(PREMIERE_UI_NAMES_FALLBACK["Motion"]?.de_DE).toContain("Bewegung");
  });

  it("caches the index per PREMIERE_DICTIONARIES_DIR value", () => {
    const first = premiereDictionaryIndex();
    expect(first?.root).toBe(root);
    expect(premiereDictionaryIndex()).toBe(first);
    process.env.PREMIERE_DICTIONARIES_DIR = join(root, "missing");
    expect(premiereDictionaryIndex()).toBeNull();
  });
});

describe("premiereDictionaryRoots", () => {
  it("honours an explicit directory, 'off' and a missing path", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-root-"));
    try {
      expect(premiereDictionaryRoots({ PREMIERE_DICTIONARIES_DIR: dir })).toEqual([dir]);
      expect(premiereDictionaryRoots({ PREMIERE_DICTIONARIES_DIR: "off" })).toEqual([]);
      expect(premiereDictionaryRoots({ PREMIERE_DICTIONARIES_DIR: " " })).toEqual([]);
      expect(premiereDictionaryRoots({ PREMIERE_DICTIONARIES_DIR: join(dir, "nope") })).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds the newest macOS install first", () => {
    const apps = mkdtempSync(join(tmpdir(), "pr-apps-"));
    try {
      for (const year of ["2025", "2026"]) {
        mkdirSync(join(apps, `Adobe Premiere Pro ${year}`, `Adobe Premiere Pro ${year}.app`, "Contents", "Dictionaries"), { recursive: true });
      }
      mkdirSync(join(apps, "Other App"));
      const roots = premiereDictionaryRoots({}, "darwin", { applicationsDir: apps });
      expect(roots).toHaveLength(2);
      expect(roots[0]).toContain("Adobe Premiere Pro 2026.app");
    } finally {
      rmSync(apps, { recursive: true, force: true });
    }
  });

  it("finds a Windows install under Program Files", () => {
    const base = mkdtempSync(join(tmpdir(), "pr-pf-"));
    try {
      mkdirSync(join(base, "Adobe", "Adobe Premiere Pro 2026", "Dictionaries"), { recursive: true });
      const roots = premiereDictionaryRoots({ ProgramFiles: base, ProgramW6432: base }, "win32", { join });
      expect(roots).toEqual([join(base, "Adobe", "Adobe Premiere Pro 2026", "Dictionaries")]);
      expect(premiereDictionaryRoots({}, "linux")).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("premiereL10nPrelude", () => {
  it("translates the script's string literals as an ES3-safe global assignment", () => {
    const prelude = premiereL10nPrelude(`__compIs(comp, "Motion"); __propIs(p, 'Scale', comp); var x = "no such name 42"; var y = "Opacity\\"";`);
    expect(prelude.startsWith("__L10N = {")).toBe(true);
    expect(prelude).toContain('"Motion":');
    expect(prelude).toContain('"Scale":');
    expect(prelude).not.toContain("no such name 42");
    // every non-ASCII character is escaped, so the file encoding cannot break it
    expect(/[^\x00-\x7f]/.test(prelude)).toBe(false);
    const table = JSON.parse(prelude.slice("__L10N = ".length, -1));
    expect(table.Motion.ru_RU).toContain("Движение");
  });

  it("is an empty table for a script without UI names", () => {
    expect(premiereL10nPrelude("return __result({ ok: true });")).toBe("__L10N = {};");
  });

  it("buildScript puts the table in front of the IIFE", () => {
    const script = buildScript('return __result(__nameIn("Движение", "Motion"));');
    expect(script.indexOf("__L10N = ")).toBe(0);
    expect(script).toContain("(function() {");
  });
});

describe("ExtendScript name helpers", () => {
  function engine(locale: string, qe?: unknown) {
    const sandbox: Record<string, unknown> = { JSON: undefined, $: { locale }, qe };
    runInNewContext(getHelpersSource(), sandbox);
    return (code: string) => runInNewContext(`${premiereL10nPrelude(code)}\n${code}`, sandbox);
  }

  it("matches English, the running UI language, and any language when the locale is unknown", () => {
    const ru = engine("ru_RU");
    expect(ru('__nameIn("Движение", "Motion")')).toBe(true);
    expect(ru('__nameIn("Motion", "Motion")')).toBe(true);
    expect(ru('__nameIn("Bewegung", "Motion")')).toBe(false);
    expect(ru("__nameIn(null, 'Motion')")).toBe(false);
    const unknown = engine("xx_XX");
    expect(unknown('__nameIn("Bewegung", "Motion")')).toBe(true);
    expect(unknown('__namesFor("no such name 42").length')).toBe(1);
  });

  it("__compIs recognises localized display names and matchName aliases", () => {
    const run = engine("ru_RU");
    const comp = (displayName: string, matchName: string) => JSON.stringify({ displayName, matchName });
    expect(run(`__compIs(${comp("Движение", "AE.ADBE Motion")}, "Motion")`)).toBe(true);
    expect(run(`__compIs(${comp("Громкость", "Internal Volume Stereo")}, "Volume")`)).toBe(true);
    expect(run(`__compIs(${comp("X", "AE.ADBE SubspaceStabilizer")}, "Warp Stabilizer")`)).toBe(true);
    expect(run(`__compIs(${comp("X", "AE.ADBE AECrop")}, "Crop")`)).toBe(true);
    expect(run(`__compIs(${comp("X", "AE.ADBE Tint")}, "Tint")`)).toBe(true);
    expect(run(`__compIs(${comp("X", "AE.ADBE Tint")}, "Motion")`)).toBe(false);
    expect(run(`__compIs(null, "Motion")`)).toBe(false);
  });

  it("__propIs / __findProp use the localized name, then the intrinsic property order", () => {
    const run = engine("ru_RU");
    const volume = `{ matchName: "Internal Volume Mono", properties: { numItems: 2, 0: { displayName: "" }, 1: { displayName: "Уровень" } } }`;
    expect(run(`var c = ${volume}; __propIs(c.properties[1], "Level", c)`)).toBe(true);
    expect(run(`var c = ${volume}; __findProp(c, "Level") === c.properties[1]`)).toBe(true);
    const motion = `{ matchName: "AE.ADBE Motion", properties: { numItems: 3, 0: { displayName: "Pos-x" }, 1: { displayName: "Scale-x" }, 2: { displayName: "W-x" } } }`;
    expect(run(`var c = ${motion}; __propIs(c.properties[1], "Scale", c)`)).toBe(true);
    expect(run(`var c = ${motion}; __findProp(c, "Scale Width") === c.properties[2]`)).toBe(true);
    expect(run(`var c = ${motion}; __findProp(c, "Rotation")`)).toBe(null);
  });

  it("__qeLookup skips QE's empty placeholder and returns the localized match", () => {
    const fake = {
      project: {
        getVideoEffectByName: (n: string) => ({ name: n === "Размытие по Гауссу" ? n : "" }),
        getAudioEffectByName: () => ({ name: "" }),
        getVideoTransitionByName: (n: string) => ({ name: n === "Перекрестное растворение" ? n : "" }),
      },
    };
    const run = engine("ru_RU", fake);
    expect(run('__qeLookup("video", "Gaussian Blur").name')).toBe("Размытие по Гауссу");
    expect(run('__qeLookup("videoTransition", "Cross Dissolve").name')).toBe("Перекрестное растворение");
    expect(run('__qeLookup("audio", "Amplify")')).toBe(null);
    expect(run('__qeLookup("audioTransition", "Constant Power")')).toBe(null);
    expect(engine("ru_RU")('__qeLookup("video", "Gaussian Blur")')).toBe(null);
  });
});

describe("resolveUxpEffectId", () => {
  it("maps English names to the host's audio display name or video matchName", async () => {
    const { resolveUxpEffectId } = await import("../../src/tools/uxp-workflows.js");
    const request = async (_command: string, args: { mediaType: string }) =>
      args.mediaType === "audio"
        ? { audio: { displayNames: ["Усилить", "Динамика"] } }
        : { video: { matchNames: ["AE.ADBE Lumetri", "AE.Impact_Blur_FX"], displayNames: ["Цвет Lumetri", "Размытие по Гауссу"] } };
    const bridge = { request } as never;
    expect(await resolveUxpEffectId(bridge, "audio", "Amplify")).toBe("Усилить");
    expect(await resolveUxpEffectId(bridge, "audio", "Своё имя")).toBe("Своё имя");
    expect(await resolveUxpEffectId(bridge, "video", "Gaussian Blur")).toBe("AE.Impact_Blur_FX");
    expect(await resolveUxpEffectId(bridge, "video", "Цвет Lumetri")).toBe("AE.ADBE Lumetri");
    expect(await resolveUxpEffectId(bridge, "video", "AE.ADBE Lumetri")).toBe("AE.ADBE Lumetri");
    expect(await resolveUxpEffectId(bridge, "video", "Unknown Thing")).toBe("Unknown Thing");
    expect(await resolveUxpEffectId(bridge, undefined, "Amplify")).toBe("Amplify");
    const failing = { request: async () => { throw new Error("offline"); } } as never;
    expect(await resolveUxpEffectId(failing, "video", "Gaussian Blur")).toBe("Gaussian Blur");
    const mismatched = { request: async () => ({ video: { matchNames: ["a.b"], displayNames: [] } }) } as never;
    expect(await resolveUxpEffectId(mismatched, "video", "Gaussian Blur")).toBe("Gaussian Blur");
  });
});
