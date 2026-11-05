// Object Mask through Premiere's UI (macOS): the agent looks at an exported frame, picks points or lasso
// outlines on it, and these operations click / drag them with the Object Mask tool, add (⊕) and subtract
// (⊖) parts, select masks, set Feather / Expansion / Inverted, track, and measure the mask by its red
// overlay. Premiere has no scripting API for masks (ExtendScript none; UXP only reads hasObjectMask).
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandResult } from "../bridge/file-bridge.js";
import { type RgbImage, resizeRgb } from "../ui/image.js";
import { type Desktop, DesktopError, MacDesktop } from "../ui/mac.js";
import { type ExportedFrame, type Shape, type Step, MaskUiError, ObjectMaskUi, findFx, findStrips, findTool } from "../ui/object-mask.js";

/** What the tools need from the desktop besides input and capture. */
export interface UiDesktop extends Desktop {
  checkAccess(): Promise<void>;
  front(): Promise<string>;
  decode(path: string, maxWidth?: number): Promise<RgbImage>;
  imageSize(path: string): Promise<{ w: number; h: number }>;
}

export interface ObjectMaskUiOptions {
  desktop?: () => UiDesktop;
  platform?: NodeJS.Platform;
}

const MAX_SHAPES = 64;
const MAX_LASSO_POINTS = 256;
const FRAME_DECODE_WIDTH = 1600;
const PREVIEW_WIDTH = 900;

const pointSchema = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 } as const;
const pointsSchema = (what: string) => ({
  type: "array", maxItems: MAX_SHAPES, items: pointSchema,
  description: `${what}: [[x, y], …] in pixels of the exported frame (frame_path). One click each — a click takes the WHOLE object under it (a whole person).`,
});
const lassosSchema = (what: string) => ({
  type: "array", maxItems: MAX_SHAPES,
  items: { type: "array", minItems: 3, maxItems: MAX_LASSO_POINTS, items: pointSchema },
  description: `${what}: [[[x, y], …], …] — each a closed outline (8–16 points around the part) in pixels of the exported frame. A lasso takes only the outlined PART (a face, a head, hands); the selection mode under the Program Monitor must be Lasso.`,
});
const frameSchema = {
  type: "string", minLength: 1, maxLength: 4096,
  description: "PNG from pr_export_frame at the CURRENT playhead (absolute path). Points and lassos are given in its pixels; it is also how the Program Monitor is found on screen, so the monitor must show the whole frame («Fit»).",
} as const;
const maskIndexSchema = { type: "integer", minimum: 0, maximum: 63, description: "Which mask, counting the mask rows in Effect Controls from the top (0 = first). The mask is selected first — Premiere drops the selection after tracking or a playhead move." } as const;

const COMMON_NOTES = [
  "macOS only. The MCP client app needs Accessibility (clicks) and Screen Recording (captures) permission.",
  "Premiere comes to the front; the clip must be selected so Effect Controls shows it; the Program Monitor shows the whole frame («Fit»).",
  "Icons are found by template matching (language-independent); verified at 1:1 on Premiere 26.5, Retina 2× by template scaling.",
];

function fail(error: string, steps: Step[] = [], clicked = false): CommandResult {
  return { success: false, error, data: { steps, mutationOutcome: clicked ? "unknown" : "not_applied", ...(clicked ? { note: "Clicks were sent before the failure — look at the Program Monitor / Effect Controls (inspect_object_mask_overlay_ui) before retrying." } : {}) } };
}

function parsePoint(v: unknown, what: string): { x: number; y: number } {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) throw new Error(`${what} must be [x, y] numbers`);
  return { x: v[0] as number, y: v[1] as number };
}

export function parseShapes(points: unknown, lassos: unknown, what: string): Shape[] {
  const out: Shape[] = [];
  if (lassos !== undefined) {
    if (!Array.isArray(lassos)) throw new Error(`${what} lassos must be an array of outlines`);
    lassos.forEach((l, i) => {
      if (!Array.isArray(l) || l.length < 3) throw new Error(`${what} lasso ${i} needs at least 3 points`);
      if (l.length > MAX_LASSO_POINTS) throw new Error(`${what} lasso ${i} has more than ${MAX_LASSO_POINTS} points`);
      out.push({ kind: "lasso", points: l.map((p, j) => parsePoint(p, `${what} lasso ${i} point ${j}`)) });
    });
  }
  if (points !== undefined) {
    if (!Array.isArray(points)) throw new Error(`${what} points must be an array of [x, y]`);
    points.forEach((p, i) => out.push({ kind: "point", ...parsePoint(p, `${what} point ${i}`) }));
  }
  if (out.length > MAX_SHAPES) throw new Error(`at most ${MAX_SHAPES} ${what} shapes per call`);
  return out;
}

function outDir(dir: unknown): string {
  if (typeof dir === "string" && dir.length) {
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  return mkdtempSync(join(tmpdir(), "pr-object-mask-"));
}

export function getObjectMaskUiTools(options: ObjectMaskUiOptions = {}) {
  const platform = options.platform ?? process.platform;
  const newDesktop = options.desktop ?? (() => new MacDesktop());

  async function prepare(framePath: unknown, needFrame: boolean): Promise<{ d: UiDesktop; frame: ExportedFrame | null }> {
    if (platform !== "darwin") throw new DesktopError("Object Mask UI operations run on macOS only (they drive Premiere's interface).");
    let frame: ExportedFrame | null = null;
    if (needFrame) {
      if (typeof framePath !== "string" || !framePath.length) throw new DesktopError("frame_path is required");
      if (!existsSync(framePath)) throw new DesktopError(`frame_path does not exist: ${framePath} — export it with pr_export_frame first`);
    }
    const d = newDesktop();
    await d.checkAccess();
    await d.front();
    if (needFrame) {
      const size = await d.imageSize(framePath as string);
      frame = { rgb: await d.decode(framePath as string, Math.min(size.w, FRAME_DECODE_WIDTH)), w: size.w, h: size.h };
    }
    return { d, frame };
  }

  async function preview(d: UiDesktop, img: RgbImage, dir: string, name: string): Promise<{ path: string; base64: string }> {
    const path = await d.savePng(img, join(dir, name));
    const small = img.w > PREVIEW_WIDTH ? resizeRgb(img, PREVIEW_WIDTH, (img.h * PREVIEW_WIDTH) / img.w) : img;
    const smallPath = small === img ? path : await d.savePng(small, join(dir, name.replace(/\.png$/, "-preview.png")));
    return { path, base64: readFileSync(smallPath).toString("base64") };
  }

  async function guard(run: (steps: { clicked: boolean }) => Promise<CommandResult>): Promise<CommandResult> {
    const state = { clicked: false };
    try {
      return await run(state);
    } catch (e) {
      if (e instanceof MaskUiError) return fail(e.message, e.steps, state.clicked);
      if (e instanceof DesktopError) return fail(e.message, [], state.clicked);
      return fail(`Object Mask UI failed: ${(e as Error).message}`, [], state.clicked);
    }
  }

  return {
    object_mask_ui: {
      description:
        "Create an Object Mask on the selected clip through Premiere's UI (no scripting API exists for masks) — macOS only. Look at the frame first (pr_export_frame at the playhead), then give points (one click = the WHOLE object under it, e.g. a whole person) and/or lassos (a closed outline = only that PART, e.g. a face — never click a figure when only its face is wanted). The first shape creates the mask on effect row effect_index (0 Motion, 1 Opacity, 2 Time Remapping, 3… effects you added — apply them before the mask); every further shape goes into the SAME mask through ⊕, subtract_* through ⊖. Optional Feather / Expansion / Inverted, then tracking. Returns the mask's index, the red-overlay extent in frame pixels and an image of the overlay to check.",
      operationalCapability: {
        backend: "local", backends: ["local"], status: "experimental", minimumPremiereVersion: "26.0",
        authority: "edit", verificationBoundary: "local_and_host_response", hostVerificationRequired: true,
        notes: [...COMMON_NOTES, "Changes the project (a new mask); Premiere's own Undo reverts it. The overlay check sees one frame — tracking quality needs pr_export_frame on other frames."],
      },
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          frame_path: frameSchema,
          points: pointsSchema("Objects to mask"),
          lassos: lassosSchema("Parts to mask"),
          subtract_points: pointsSchema("Objects to remove from the mask (⊖)"),
          subtract_lassos: lassosSchema("Parts to remove from the mask (⊖; clicks remove more reliably than lassos)"),
          effect_index: { type: "integer", minimum: 0, maximum: 63, description: "Effect row in Effect Controls that gets the mask, from the top: 0 Motion, 1 Opacity (default), 2 Time Remapping, 3… added effects." },
          track: { type: "string", enum: ["none", "forward", "both"], description: "Track the mask after creating it (default forward)." },
          feather: { type: "integer", minimum: 0, maximum: 1000, description: "Mask Feather, a whole number (a radius; the real 10–90 % edge is ≈ 2× it + 2 px). Typed into Premiere, whose decimal separator depends on its UI language — so whole numbers only." },
          expansion: { type: "integer", minimum: -1000, maximum: 1000, description: "Mask Expansion, a whole number (negative pulls the edge inside the object)." },
          inverted: { type: "boolean", description: "Mask Inverted." },
          tool_shortcut: { type: "boolean", description: "Select the Object Mask tool with Cmd+Opt+O instead of its toolbar icon — only when that shortcut was assigned to the tool in Premiere's Keyboard Shortcuts (it is not by default)." },
          output_dir: { type: "string", minLength: 1, maxLength: 4096, description: "Folder for the overlay images (default: a temporary folder)." },
          dry_run: { type: "boolean", description: "Only locate the monitor, the tool and the effect rows and return the plan — no clicks." },
          timeout_seconds: { type: "integer", minimum: 10, maximum: 3600, description: "Tracking timeout (default 900)." },
        },
        required: ["frame_path"],
      },
      handler: async (args: Record<string, unknown>): Promise<CommandResult> =>
        guard(async (state) => {
          let shapes: Shape[], subs: Shape[];
          try {
            shapes = parseShapes(args.points, args.lassos, "mask");
            subs = parseShapes(args.subtract_points, args.subtract_lassos, "subtract");
          } catch (e) {
            return fail((e as Error).message);
          }
          if (!shapes.length) return fail("give at least one point or lasso");
          const effectIndex = typeof args.effect_index === "number" ? args.effect_index : 1;
          const { d, frame } = await prepare(args.frame_path, true);
          const ui = new ObjectMaskUi(d, frame);
          if (args.dry_run === true) {
            const shot = await ui.snap();
            const mon = await ui.monitor();
            const fx = findFx(shot), tool = findTool(shot);
            return {
              success: true,
              data: {
                dryRun: true, monitor: { score: mon.score, rect: [mon.x, mon.y, mon.w, mon.h] },
                effectRows: fx.rows.length, toolFound: tool.found, masksVisible: findStrips(shot).length,
                plan: { createBy: shapes[0].kind, add: shapes.length - 1, subtract: subs.length, effectIndex },
                steps: ui.steps,
              },
            };
          }
          state.clicked = true;
          const created = await ui.create(effectIndex, shapes[0], args.tool_shortcut === true);
          if (shapes.length > 1) await ui.editShapes("add", shapes.slice(1));
          if (subs.length) await ui.editShapes("sub", subs);
          if (args.feather !== undefined || args.expansion !== undefined || args.inverted !== undefined) {
            const st = await ui.selectMask(created.stripIndex);
            await ui.setParams(st, { feather: args.feather as number | undefined, expansion: args.expansion as number | undefined, inverted: args.inverted as boolean | undefined });
          }
          const trackMode = (args.track as string | undefined) ?? "forward";
          let tracking: { done: boolean; seconds: number } | null = null;
          if (trackMode !== "none") {
            const st = await ui.selectMask(created.stripIndex);
            tracking = await ui.track(st, trackMode as "forward" | "both", ((args.timeout_seconds as number | undefined) ?? 900) * 1000);
          }
          await ui.selectMask(created.stripIndex);
          const ov = await ui.overlay();
          const dir = outDir(args.output_dir);
          const img = await preview(d, ov.crop, dir, "object-mask-overlay.png");
          return {
            success: true,
            data: {
              outcome: "committed_unverified",
              maskIndex: created.stripIndex,
              shapes: { created: shapes[0].kind, added: shapes.length - 1, subtracted: subs.length },
              overlay: { found: ov.found, areaFrac: ov.areaFrac, bboxFrame: ov.bboxFrame ?? null },
              tracking,
              overlayImage: img.path,
              steps: ui.steps,
              check: "Red in the image = the mask on this frame. Check other frames with pr_export_frame / inspect_object_mask_overlay_ui after moving the playhead; fix a frame where a part was lost ON that frame (object_mask_edit_ui), then object_mask_track_ui from it.",
              mimeType: "image/png",
              base64: img.base64,
              imageCaption: `Object mask ${created.stripIndex}: red = masked (${Math.round(ov.areaFrac * 1000) / 10} % of the frame).`,
            },
          };
        }),
    },

    object_mask_edit_ui: {
      description:
        "Add (⊕) or subtract (⊖) objects or parts to/from an existing Object Mask through Premiere's UI — macOS only. Selects mask_index first (Premiere drops the selection after tracking or a playhead move). Points click whole objects; lassos outline only a part (a face). Move the playhead to the frame that needs the fix and export that frame first; afterwards re-track from it with object_mask_track_ui.",
      operationalCapability: {
        backend: "local", backends: ["local"], status: "experimental", minimumPremiereVersion: "26.0",
        authority: "edit", verificationBoundary: "local_and_host_response", hostVerificationRequired: true, notes: COMMON_NOTES,
      },
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          frame_path: frameSchema,
          mode: { type: "string", enum: ["add", "subtract"], description: "add = ⊕, subtract = ⊖." },
          points: pointsSchema("Objects"),
          lassos: lassosSchema("Parts"),
          mask_index: maskIndexSchema,
          output_dir: { type: "string", minLength: 1, maxLength: 4096, description: "Folder for the overlay image (default: a temporary folder)." },
        },
        required: ["frame_path", "mode"],
      },
      handler: async (args: Record<string, unknown>): Promise<CommandResult> =>
        guard(async (state) => {
          let shapes: Shape[];
          try {
            shapes = parseShapes(args.points, args.lassos, args.mode === "subtract" ? "subtract" : "add");
          } catch (e) {
            return fail((e as Error).message);
          }
          if (args.mode !== "add" && args.mode !== "subtract") return fail("mode must be add or subtract");
          if (!shapes.length) return fail("give at least one point or lasso");
          const { d, frame } = await prepare(args.frame_path, true);
          const ui = new ObjectMaskUi(d, frame);
          state.clicked = true;
          const idx = typeof args.mask_index === "number" ? args.mask_index : 0;
          await ui.selectMask(idx);
          await ui.editShapes(args.mode === "add" ? "add" : "sub", shapes);
          await ui.selectMask(idx);
          const ov = await ui.overlay();
          const img = await preview(d, ov.crop, outDir(args.output_dir), "object-mask-overlay.png");
          return {
            success: true,
            data: {
              outcome: "committed_unverified", maskIndex: idx, mode: args.mode, shapes: shapes.length,
              overlay: { found: ov.found, areaFrac: ov.areaFrac, bboxFrame: ov.bboxFrame ?? null },
              overlayImage: img.path, steps: ui.steps, mimeType: "image/png", base64: img.base64,
              imageCaption: `Object mask ${idx} after ${args.mode}: red = masked.`,
            },
          };
        }),
    },

    object_mask_select_ui: {
      description: "Select an Object Mask by its row in Effect Controls (0 = the first mask from the top) through Premiere's UI — macOS only. ⊕/⊖ and the red overlay show only for a selected mask.",
      operationalCapability: {
        backend: "local", backends: ["local"], status: "experimental", minimumPremiereVersion: "26.0",
        authority: "edit", verificationBoundary: "local_and_host_response", hostVerificationRequired: true, notes: COMMON_NOTES,
      },
      parameters: { type: "object" as const, additionalProperties: false, properties: { mask_index: maskIndexSchema }, required: ["mask_index"] },
      handler: async (args: Record<string, unknown>): Promise<CommandResult> =>
        guard(async (state) => {
          const { d } = await prepare(undefined, false);
          const ui = new ObjectMaskUi(d, null);
          state.clicked = true;
          await ui.selectMask(args.mask_index as number);
          return { success: true, data: { selected: args.mask_index, steps: ui.steps } };
        }),
    },

    object_mask_params_ui: {
      description: "Set an Object Mask's Feather, Expansion and Inverted through Premiere's UI (these are not in the scripting API) — macOS only. Values are typed into the mask's rows in Effect Controls; read them back on screen or by the overlay.",
      operationalCapability: {
        backend: "local", backends: ["local"], status: "experimental", minimumPremiereVersion: "26.0",
        authority: "edit", verificationBoundary: "local_and_host_response", hostVerificationRequired: true, notes: COMMON_NOTES,
      },
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          mask_index: maskIndexSchema,
          feather: { type: "integer", minimum: 0, maximum: 1000, description: "Feather, a whole number (a radius)." },
          expansion: { type: "integer", minimum: -1000, maximum: 1000, description: "Expansion, a whole number (negative = inside the object)." },
          inverted: { type: "boolean", description: "Inverted." },
        },
        required: ["mask_index"],
      },
      handler: async (args: Record<string, unknown>): Promise<CommandResult> =>
        guard(async (state) => {
          if (args.feather === undefined && args.expansion === undefined && args.inverted === undefined) return fail("give feather, expansion or inverted");
          const { d } = await prepare(undefined, false);
          const ui = new ObjectMaskUi(d, null);
          state.clicked = true;
          const st = await ui.selectMask(args.mask_index as number);
          const set = await ui.setParams(st, { feather: args.feather as number | undefined, expansion: args.expansion as number | undefined, inverted: args.inverted as boolean | undefined });
          return { success: true, data: { outcome: "committed_unverified", maskIndex: args.mask_index, set, steps: ui.steps } };
        }),
    },

    object_mask_track_ui: {
      description: "Track an Object Mask from the current playhead (forward, backward or both) through Premiere's UI and wait until tracking ends — macOS only. Use after fixing the mask on the frame where it lost a part.",
      operationalCapability: {
        backend: "local", backends: ["local"], status: "experimental", minimumPremiereVersion: "26.0",
        authority: "edit", verificationBoundary: "local_and_host_response", hostVerificationRequired: true, notes: COMMON_NOTES,
      },
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          mask_index: maskIndexSchema,
          direction: { type: "string", enum: ["forward", "backward", "both"], description: "Default forward." },
          timeout_seconds: { type: "integer", minimum: 10, maximum: 3600, description: "Default 900." },
        },
        required: ["mask_index"],
      },
      handler: async (args: Record<string, unknown>): Promise<CommandResult> =>
        guard(async (state) => {
          const { d } = await prepare(undefined, false);
          const ui = new ObjectMaskUi(d, null);
          state.clicked = true;
          const st = await ui.selectMask(args.mask_index as number);
          const dir = (args.direction as "forward" | "backward" | "both" | undefined) ?? "forward";
          const res = await ui.track(st, dir, ((args.timeout_seconds as number | undefined) ?? 900) * 1000);
          if (!res.done) return fail(`tracking did not finish in ${res.seconds} s`, ui.steps, true);
          return { success: true, data: { outcome: "committed_unverified", maskIndex: args.mask_index, direction: dir, ...res, steps: ui.steps } };
        }),
    },

    inspect_object_mask_overlay_ui: {
      description: "Read-only: measure the SELECTED Object Mask on the current frame by its red overlay in the Program Monitor (extent in frame pixels, share of the frame) and return the overlay image — macOS only. Export the frame at the playhead first (frame_path); select the mask with object_mask_select_ui if needed.",
      operationalCapability: {
        backend: "local", backends: ["local"], status: "experimental", minimumPremiereVersion: "26.0",
        authority: "inspect", verificationBoundary: "local_and_host_response", hostVerificationRequired: true, notes: COMMON_NOTES,
      },
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          frame_path: frameSchema,
          output_dir: { type: "string", minLength: 1, maxLength: 4096, description: "Folder for the overlay image (default: a temporary folder)." },
        },
        required: ["frame_path"],
      },
      handler: async (args: Record<string, unknown>): Promise<CommandResult> =>
        guard(async () => {
          const { d, frame } = await prepare(args.frame_path, true);
          const ui = new ObjectMaskUi(d, frame);
          const ov = await ui.overlay();
          const img = await preview(d, ov.crop, outDir(args.output_dir), "object-mask-overlay.png");
          return {
            success: true,
            data: {
              overlay: { found: ov.found, areaFrac: ov.areaFrac, bboxFrame: ov.bboxFrame ?? null },
              masksVisible: findStrips(ui.current()!).length,
              overlayImage: img.path, mimeType: "image/png", base64: img.base64,
              imageCaption: ov.found ? "Red = the selected mask on this frame." : "No red overlay — no mask is selected, or the mask is empty on this frame.",
            },
          };
        }),
    },
  };
}
