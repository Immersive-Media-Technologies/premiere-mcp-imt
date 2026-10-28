/**
 * Premiere Pro UI-language independence.
 *
 * Premiere localizes every name a script can see: effects ("Gaussian Blur" is
 * "Размытие по Гауссу" on a Russian UI and "Gaußscher Weichzeichner" on a German
 * one), their parameters, transitions and the intrinsic components (Motion,
 * Opacity, Volume). The QE lookups (getVideoEffectByName and friends) accept only
 * the localized name, and component parameters carry no matchName, so a tool or
 * an agent that says "Gaussian Blur" fails on every non-English Premiere.
 *
 * Premiere ships the ZString dictionaries of all its UI languages inside the app
 * (`<Premiere>.app/Contents/Dictionaries/<locale>/` on macOS,
 * `<Premiere>\Dictionaries\<locale>\` on Windows). An English name is translated
 * through Premiere's own dictionaries: every key whose en_US value equals the name
 * yields that key's value in each other UI language. A small table generated from
 * the same dictionaries (premiere-ui-names.generated.ts) covers the names the
 * tools themselves use when the dictionaries cannot be found.
 *
 * buildScript() embeds the translations of the string literals a script uses as
 * the global `__L10N`; the ExtendScript helpers (__namesFor, __nameIn, __qeLookup,
 * __compIs, __propIs) try the English name first, then the names of the running
 * UI language (`$.locale`).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { PREMIERE_UI_NAMES_FALLBACK } from "./premiere-ui-names.generated.js";

/** locale (Premiere folder name, e.g. "ru_RU") → localized names */
export type UiNameTranslations = Record<string, string[]>;

/** UI languages Premiere Pro 2026 ships (one dictionary folder each). */
export const PREMIERE_UI_LOCALES = ["en_US", "de_DE", "es_ES", "fr_FR", "it_IT", "ja_JP", "ko_KR", "pt_BR", "ru_RU", "zh_CN"] as const;

const LOCALE_DIR = /^[a-z]{2}_[A-Z]{2}$/;
const DICTIONARY_FILE = /\.(dat|dict)$/i;
const ENTRY = /^"(\$\$\$\/[^=]+)=(.*)"\s*$/;
const MAX_NAME_LENGTH = 80;

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Premiere dictionary roots, newest install first. PREMIERE_DICTIONARIES_DIR
 * overrides discovery ("off" or "" disables the runtime dictionaries).
 */
export function premiereDictionaryRoots(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  options: { applicationsDir?: string; join?: (...parts: string[]) => string } = {},
): string[] {
  const explicit = env.PREMIERE_DICTIONARIES_DIR;
  if (explicit !== undefined) {
    if (explicit.trim() === "" || explicit.trim().toLowerCase() === "off") return [];
    return existsSync(explicit) ? [explicit] : [];
  }
  const roots: string[] = [];
  const newestFirst = (names: string[]) => names.filter((name) => name.startsWith("Adobe Premiere Pro")).sort().reverse();
  const join = options.join ?? (platform === "win32" ? win32.join : posix.join);
  if (platform === "darwin") {
    const apps = options.applicationsDir ?? "/Applications";
    for (const folder of newestFirst(safeList(apps))) {
      for (const bundle of newestFirst(safeList(join(apps, folder))).filter((name) => name.endsWith(".app"))) {
        const dir = join(apps, folder, bundle, "Contents", "Dictionaries");
        if (existsSync(dir)) roots.push(dir);
      }
    }
  } else if (platform === "win32") {
    const bases = [env.ProgramFiles, env.ProgramW6432, "C:\\Program Files"].filter((base): base is string => Boolean(base));
    for (const base of [...new Set(bases)]) {
      const adobe = join(base, "Adobe");
      for (const folder of newestFirst(safeList(adobe))) {
        const dir = join(adobe, folder, "Dictionaries");
        if (existsSync(dir) && !roots.includes(dir)) roots.push(dir);
      }
    }
  }
  return roots;
}

function isNameLike(value: string): boolean {
  if (!value || value.length > MAX_NAME_LENGTH) return false;
  // format strings, ZString escapes and multi-line text are never UI names
  return !/[%^@\r\n]|\\[rn]/.test(value);
}

function* readEntries(dir: string, join: (...parts: string[]) => string): Generator<[string, string]> {
  for (const file of safeList(dir).filter((name) => DICTIONARY_FILE.test(name)).sort()) {
    let text: string;
    try {
      text = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('"$$$/')) continue;
      const match = ENTRY.exec(line);
      if (match) yield [match[1], match[2]];
    }
  }
}

export interface PremiereDictionaryIndex {
  root: string;
  locales: string[];
  /** English UI name → dictionary keys carrying it */
  englishKeys: Map<string, string[]>;
  /** lower-cased English UI name → its spelling in the dictionary */
  englishLower: Map<string, string>;
  /** locale → key → localized values (only keys of English UI names; a key can
   *  carry different values in different files of one locale) */
  localized: Map<string, Map<string, string[]>>;
}

/** Parse one Premiere dictionary root (all its locale folders). */
export function buildPremiereDictionaryIndex(root: string): PremiereDictionaryIndex {
  const join = /^[A-Za-z]:\\/.test(root) ? win32.join : posix.join;
  const locales = safeList(root).filter((name) => LOCALE_DIR.test(name)).sort();
  if (!locales.includes("en_US")) throw new Error(`no en_US dictionary in ${root}`);
  const englishKeys = new Map<string, string[]>();
  const englishLower = new Map<string, string>();
  const wanted = new Set<string>();
  for (const [key, value] of readEntries(join(root, "en_US"), join)) {
    if (!isNameLike(value)) continue;
    let keys = englishKeys.get(value);
    if (!keys) englishKeys.set(value, (keys = []));
    if (!keys.includes(key)) keys.push(key);
    if (!englishLower.has(value.toLowerCase())) englishLower.set(value.toLowerCase(), value);
    wanted.add(key);
  }
  const localized = new Map<string, Map<string, string[]>>();
  for (const locale of locales) {
    if (locale === "en_US") continue;
    const values = new Map<string, string[]>();
    for (const [key, value] of readEntries(join(root, locale), join)) {
      if (!wanted.has(key) || !isNameLike(value)) continue;
      const list = values.get(key);
      if (!list) values.set(key, [value]);
      else if (!list.includes(value)) list.push(value);
    }
    localized.set(locale, values);
  }
  return { root, locales, englishKeys, englishLower, localized };
}

let cachedIndex: PremiereDictionaryIndex | null | undefined;
let cachedEnvKey: string | undefined;

/** The dictionary index of the newest Premiere install, or null when none is found. */
export function premiereDictionaryIndex(): PremiereDictionaryIndex | null {
  const envKey = process.env.PREMIERE_DICTIONARIES_DIR ?? "";
  if (cachedIndex !== undefined && cachedEnvKey === envKey) return cachedIndex;
  cachedEnvKey = envKey;
  cachedIndex = null;
  for (const root of premiereDictionaryRoots()) {
    try {
      cachedIndex = buildPremiereDictionaryIndex(root);
      break;
    } catch {
      /* try the next install */
    }
  }
  return cachedIndex;
}

/** Test hook: forget the parsed dictionaries. */
export function resetPremiereDictionaryCache(): void {
  cachedIndex = undefined;
  cachedEnvKey = undefined;
}

// Keys that name an effect, transition or parameter come first, so the QE lookup
// tries the effect's own name before a homonym from a menu or a dialog.
function keyRank(key: string): number {
  if (/\/Name$/i.test(key)) return 0;
  if (/Effect|Filter|Transition/i.test(key)) return 1;
  if (/LStr|Param|Label/i.test(key)) return 2;
  return 3;
}

function addName(target: UiNameTranslations, locale: string, value: string, english: string): void {
  if (!value || value === english) return;
  const list = target[locale] ?? (target[locale] = []);
  if (!list.includes(value)) list.push(value);
}

/**
 * Localized spellings of an English Premiere UI name in every installed UI
 * language, or undefined when the name is unknown. The English name itself is
 * not repeated.
 */
export function premiereUiNameTranslations(name: string): UiNameTranslations | undefined {
  const english = String(name ?? "").trim();
  if (!english || english.length > MAX_NAME_LENGTH || !/[A-Za-z]/.test(english)) return undefined;
  const out: UiNameTranslations = {};
  const index = premiereDictionaryIndex();
  if (index) {
    const spelled = index.englishKeys.has(english) ? english : index.englishLower.get(english.toLowerCase());
    const keys = spelled ? [...(index.englishKeys.get(spelled) ?? [])].sort((a, b) => keyRank(a) - keyRank(b)) : [];
    for (const [locale, values] of index.localized) {
      for (const key of keys) {
        for (const value of values.get(key) ?? []) addName(out, locale, value, english);
      }
    }
  }
  const fallback = PREMIERE_UI_NAMES_FALLBACK[english];
  if (fallback) {
    for (const [locale, values] of Object.entries(fallback)) {
      for (const value of values) addName(out, locale, value, english);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const STRING_LITERAL = /"((?:[^"\\\r\n]|\\.){1,200})"|'((?:[^'\\\r\n]|\\.){1,200})'/g;

function unescapeLiteral(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, escaped: string) => {
    if (escaped.length === 5) return String.fromCharCode(parseInt(escaped.slice(1), 16));
    return ({ n: "\n", r: "\r", t: "\t" } as Record<string, string>)[escaped] ?? escaped;
  });
}

/** JSON as an ES3 literal: every non-ASCII character as \uXXXX (also U+2028/2029). */
function es3Json(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * Translation table for the string literals of an ExtendScript body, as the
 * global assignment buildScript() puts in front of the script.
 */
export function premiereL10nPrelude(code: string): string {
  const table: Record<string, UiNameTranslations> = {};
  for (const match of code.matchAll(STRING_LITERAL)) {
    const value = unescapeLiteral(match[1] ?? match[2] ?? "").trim();
    if (!value || value.length > MAX_NAME_LENGTH || table[value] || !/[A-Za-z]/.test(value)) continue;
    const translations = premiereUiNameTranslations(value);
    if (translations) table[value] = translations;
  }
  return `__L10N = ${es3Json(table)};`;
}
