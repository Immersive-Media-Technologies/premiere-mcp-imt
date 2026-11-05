// Speed keyframes (Time Remapping) through Premiere's UI (macOS): scripting can read only a clip's constant
// speed, so the keyframes are added with Effect Controls' ◇ at a script-set playhead and placed by Shift-
// dragging their handles on the timeline, closed-loop against the playhead parked at each target time.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BridgeOptions, type CommandResult, sendCommand } from "../bridge/file-bridge.js";
import { buildToolScript } from "../bridge/script-builder.js";
import { type RgbImage, resizeRgb } from "../ui/image.js";
import { DesktopError, MacDesktop, type PointerDesktop } from "../ui/mac.js";
import {
  type ClipInfo, type RemapBridge, type RemapPoint, RemapPlanError, RemapUiError, TimeRemapUi,
  findKeyStrip, keyHandles, planRemap,
} from "../ui/time-remap.js";
import type { UiDesktop } from "./object-mask-ui.js";

export type RemapDesktop = UiDesktop & PointerDesktop;

export interface TimeRemapUiOptions {
  desktop?: () => RemapDesktop;
  bridge?: (nodeId: string) => RemapBridge;
  platform?: NodeJS.Platform;
}

const MAX_POINTS = 32;
const PREVIEW_WIDTH = 1200;

const NOTES = [
  "macOS only. The MCP client app needs Accessibility (clicks) and Screen Recording (captures) permission.",
  "Premiere comes to the front. The clip's video track must be tall enough to show clip keyframes; the clip is selected, Effect Controls must show its Time Remapping row, the timeline is zoomed with «=» / «-» (key codes, any keyboard layout) and framed on the clip at the end.",
  "Icons are found by template matching and colours (language-independent); verified at 1:1 on Premiere 26.5, Retina 2× by template scaling.",
];

const js = (v: unknown): string => JSON.stringify(v);

async function run<T>(script: string, bridgeOptions: BridgeOptions): Promise<T> {
  const r = await sendCommand(buildToolScript(script), bridgeOptions);
  if (!r.success) throw new DesktopError(r.error ?? "Premiere script failed");
  return r.data as T;
}

/** The scripting half: clip facts, selection, playhead, undo index. */
export function scriptBridge(nodeId: string, bridgeOptions: BridgeOptions): RemapBridge {
  return {
    clip: () => run<ClipInfo>(`
      var found = __findClip(${js(nodeId)});
      if (!found) return __error("Clip not found: " + ${js(nodeId)} + ". Nothing was changed.");
      if (found.trackType !== "video") return __error("Time Remapping needs a video clip; " + ${js(nodeId)} + " is on an audio track. Nothing was changed.");
      var seq = app.project.activeSequence, clip = found.clip;
      var frame = __sequenceFrameTicks(seq);
      if (!isFinite(frame)) return __error("The sequence frame grid is unreadable. Nothing was changed.");
      var speed = 1, reversed = false;
      try { speed = Number(clip.getSpeed()); } catch (eSp) {}
      try { reversed = clip.isSpeedReversed() ? true : false; } catch (eRv) {}
      var track = seq.videoTracks[found.trackIndex], startT = parseFloat(clip.start.ticks), next = null;
      for (var c = 0; c < track.clips.numItems; c++) {
        var other = parseFloat(track.clips[c].start.ticks);
        if (other > startT + 1 && (next === null || other < next)) next = other;
      }
      return __result({
        name: String(clip.name), start: __ticksToSeconds(clip.start.ticks), end: __ticksToSeconds(clip.end.ticks),
        inPoint: __ticksToSeconds(clip.inPoint.ticks), outPoint: __ticksToSeconds(clip.outPoint.ticks),
        speed: isFinite(speed) ? speed : 1, reversed: reversed, frame: frame / TICKS_PER_SECOND,
        nextStart: next === null ? null : __ticksToSeconds(next), trackIndex: found.trackIndex
      });
    `, bridgeOptions),
    selectOnly: async () => {
      await run(`
        var found = __findClip(${js(nodeId)});
        if (!found) return __error("Clip not found: " + ${js(nodeId)} + ". Nothing was changed.");
        var seq = app.project.activeSequence, groups = [seq.videoTracks, seq.audioTracks];
        for (var g = 0; g < 2; g++) for (var t = 0; t < groups[g].numTracks; t++) {
          var tr = groups[g][t];
          for (var c = 0; c < tr.clips.numItems; c++) { try { if (tr.clips[c].isSelected()) tr.clips[c].setSelected(false, true); } catch (eSel) {} }
        }
        found.clip.setSelected(true, true);
        return __result({ selected: found.clip.isSelected() ? true : false });
      `, bridgeOptions);
    },
    setPlayhead: async (seconds: number) => {
      const r = await run<{ seconds: number }>(`
        var seq = app.project.activeSequence;
        if (!seq) return __error("No active sequence. Nothing was changed.");
        var ticks = __snapSequenceTicks(seq, __secondsToTicks(${Math.max(0, seconds)}));
        seq.setPlayerPosition(String(Math.round(ticks)));
        return __result({ seconds: __ticksToSeconds(seq.getPlayerPosition().ticks) });
      `, bridgeOptions);
      return r.seconds;
    },
    getPlayhead: async () => {
      const r = await run<{ seconds: number }>(`
        var seq = app.project.activeSequence;
        if (!seq) return __error("No active sequence. Nothing was changed.");
        return __result({ seconds: __ticksToSeconds(seq.getPlayerPosition().ticks) });
      `, bridgeOptions);
      return r.seconds;
    },
    undoIndex: async () => {
      try {
        const r = await run<{ index: number | null }>(`return __result({ index: __readUndoIndex() });`, bridgeOptions);
        return typeof r.index === "number" ? r.index : null;
      } catch {
        return null;
      }
    },
  };
}

function parsePoints(v: unknown): RemapPoint[] {
  if (!Array.isArray(v) || !v.length) throw new Error("points must be a non-empty array of {source_seconds, sequence_seconds}");
  if (v.length > MAX_POINTS) throw new Error(`at most ${MAX_POINTS} points per call`);
  return v.map((p, i) => {
    const o = p as Record<string, unknown>;
    if (!o || typeof o.source_seconds !== "number" || typeof o.sequence_seconds !== "number" || !Number.isFinite(o.source_seconds) || !Number.isFinite(o.sequence_seconds) || o.source_seconds < 0 || o.sequence_seconds < 0) {
      throw new Error(`point ${i} needs finite non-negative source_seconds and sequence_seconds`);
    }
    return { source: o.source_seconds, sequence: o.sequence_seconds };
  });
}

function outDir(dir: unknown): string {
  if (typeof dir === "string" && dir.length) {
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  return mkdtempSync(join(tmpdir(), "pr-time-remap-"));
}

function fail(error: string, steps: unknown[] = [], mutated = false): CommandResult {
  return {
    success: false, error,
    data: { steps, mutationOutcome: mutated ? "unknown" : "not_applied", ...(mutated ? { note: "Speed keyframes were added or dragged before the failure — look at the clip (inspect_time_remap_ui) or undo (Premiere's Undo; the result of a successful call reports undo indexes)." } : {}) },
  };
}

export function getTimeRemapUiTools(bridgeOptions: BridgeOptions, options: TimeRemapUiOptions = {}) {
  const platform = options.platform ?? process.platform;
  const newDesktop = options.desktop ?? (() => new MacDesktop());
  const newBridge = options.bridge ?? ((id: string) => scriptBridge(id, bridgeOptions));

  async function prepare(): Promise<RemapDesktop> {
    if (platform !== "darwin") throw new DesktopError("Time Remapping UI operations run on macOS only (they drive Premiere's interface).");
    const d = newDesktop();
    await d.checkAccess();
    await d.front();
    return d;
  }

  async function preview(d: RemapDesktop, img: RgbImage, dir: string, name: string): Promise<{ path: string; base64: string }> {
    const path = await d.savePng(img, join(dir, name));
    const small = img.w > PREVIEW_WIDTH ? resizeRgb(img, PREVIEW_WIDTH, Math.max(1, Math.round((img.h * PREVIEW_WIDTH) / img.w))) : img;
    const smallPath = small === img ? path : await d.savePng(small, join(dir, name.replace(/\.png$/, "-preview.png")));
    return { path, base64: readFileSync(smallPath).toString("base64") };
  }

  function nodeIdOf(args: Record<string, unknown>): string {
    if (typeof args.node_id !== "string" || !args.node_id.length) throw new Error("node_id is required (pr_get_sequence lists it)");
    return args.node_id;
  }

  return {
    time_remap_ui: {
      description:
        "Speed keyframes (Time Remapping) on a video clip through Premiere's UI — macOS only; no scripting API can set them. Give points «this media frame plays at this sequence time»: {source_seconds (media time), sequence_seconds}. Each point becomes a speed keyframe on that media frame, placed at that sequence time; the segment to its left gets the speed that lands it there (Δsource / Δsequence, from the clip start for the first point); after the last point the clip runs at 100 % (it gets longer or shorter). Example — a clip at 0 s with in-point 0, media 1–2 s at 50 %: points [{source_seconds:1, sequence_seconds:1}, {source_seconds:2, sequence_seconds:3}]. The clip must run at 100 % with no speed keyframes yet, and must not grow into a following clip. Keyframes are added with Effect Controls' ◇ at the playhead and Shift-dragged on the timeline onto the playhead parked at each target, zooming in until one pixel is finer than tolerance_frames. Returns each keyframe's speed and measured offset, the clip end read back against the expected one, undo indexes, and a timeline image.",
      operationalCapability: {
        backend: "local", backends: ["local"], status: "experimental", minimumPremiereVersion: "26.0",
        authority: "edit", verificationBoundary: "local_and_host_response", hostVerificationRequired: true,
        notes: [...NOTES, "Changes the project (speed keyframes; each click and drag is one Undo step). Offsets are measured on screen; rendered timing needs pr_export_frame checks."],
      },
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          node_id: { type: "string", minLength: 1, maxLength: 200, description: "The video clip (pr_get_sequence lists node_id)." },
          points: {
            type: "array", minItems: 1, maxItems: MAX_POINTS,
            description: "Speed keyframes, left to right: the media frame at source_seconds plays at sequence_seconds. Both increase by at least one frame; segment speeds must stay within 10–1000 %. Times snap to sequence frames.",
            items: {
              type: "object", additionalProperties: false, required: ["source_seconds", "sequence_seconds"],
              properties: {
                source_seconds: { type: "number", minimum: 0, description: "Media time of the frame (seconds, the clip's source timecode from 0)." },
                sequence_seconds: { type: "number", minimum: 0, description: "Sequence time where that frame plays." },
              },
            },
          },
          tolerance_frames: { type: "number", minimum: 0.02, maximum: 1, description: "How close each keyframe must end up to its target, in frames (default 0.1). The timeline is zoomed in until a pixel is finer; at Premiere's maximum zoom the reached precision is reported." },
          fit_view: { type: "boolean", description: "Frame the whole re-timed clip on the timeline at the end (default true) — also how every keyframe is recounted." },
          output_dir: { type: "string", minLength: 1, maxLength: 4096, description: "Folder for the timeline image (default: a temporary folder)." },
          dry_run: { type: "boolean", description: "Only read the clip and return the keyframe plan (speeds, where each keyframe is added and placed) — no clicks." },
        },
        required: ["node_id", "points"],
      },
      handler: async (args: Record<string, unknown>): Promise<CommandResult> => {
        let points: RemapPoint[], nodeId: string;
        try {
          nodeId = nodeIdOf(args);
          points = parsePoints(args.points);
        } catch (e) {
          return fail((e as Error).message);
        }
        const tol = typeof args.tolerance_frames === "number" ? args.tolerance_frames : 0.1;
        if (!(tol >= 0.02 && tol <= 1)) return fail("tolerance_frames must be within 0.02–1");
        const bridge = newBridge(nodeId);
        if (args.dry_run === true) {
          try {
            const info = await bridge.clip();
            const plan = planRemap(info, points);
            return { success: true, data: { dryRun: true, clip: info, plan: plan.map((k) => ({ ...k, speedLeftPercent: Math.round(k.speedLeft * 1e6) / 1e4 })) } };
          } catch (e) {
            return fail(e instanceof RemapPlanError ? `${e.message}. Nothing was changed.` : (e as Error).message);
          }
        }
        let ui: TimeRemapUi | null = null;
        try {
          const d = await prepare();
          ui = new TimeRemapUi(d, bridge);
          const r = await ui.run(points, { toleranceFrames: tol, fitAtEnd: args.fit_view !== false });
          const img = await preview(d, r.preview, outDir(args.output_dir), "time-remap.png");
          const f = r.clip.frame;
          const endOk = Math.abs(r.endSeconds - r.expectedEndSeconds) <= f * 1.01;
          const worst = Math.max(...r.keys.map((k) => Math.abs(k.offsetFrames)));
          const countOk = r.handlesAtEnd === null || r.handlesAtEnd === r.keys.length;
          return {
            success: true,
            data: {
              outcome: endOk && countOk ? "verified" : "committed_unverified",
              clip: { nodeId, name: r.clip.name, startSeconds: r.clip.start, endBeforeSeconds: r.clip.end, endSeconds: r.endSeconds, expectedEndSeconds: r.expectedEndSeconds, endMatches: endOk },
              keyframes: r.keys, worstOffsetFrames: worst,
              keyframesCounted: r.handlesAtEnd,
              undo: r.undoIndexBefore !== null && r.undoIndexAfter !== null
                ? { undoStackIndexBefore: r.undoIndexBefore, undoStackIndex: r.undoIndexAfter, undoSteps: r.undoIndexAfter - r.undoIndexBefore }
                : null,
              verification: "keyframe positions measured against the playhead on screen; clip end read back through scripting (frame-rounded). Rendered timing: pr_export_frame.",
              timelineImage: img.path, mimeType: "image/png", base64: img.base64,
              imageCaption: "The clip's speed-keyframe strip after the change: one hourglass handle per keyframe.",
              steps: ui.steps,
            },
          };
        } catch (e) {
          if (e instanceof RemapUiError) return fail(e.message, e.steps, e.mutated);
          if (e instanceof DesktopError) return fail(e.message, ui?.steps ?? [], ui?.mutated ?? false);
          return fail(`Time Remapping UI failed: ${(e as Error).message}`, ui?.steps ?? [], ui?.mutated ?? false);
        }
      },
    },

    inspect_time_remap_ui: {
      description: "Read-only: where a clip's speed keyframes (Time Remapping) sit on the timeline, measured on screen — macOS only; scripting cannot read them. The clip must show Time Remapping › Speed on the timeline (time_remap_ui sets that) and be in view. Moves the playhead to measure the timeline scale and puts it back. Returns keyframe times in sequence seconds with their precision, the clip's start/end, and a timeline image.",
      operationalCapability: {
        backend: "local", backends: ["local"], status: "experimental", minimumPremiereVersion: "26.0",
        authority: "inspect", verificationBoundary: "local_and_host_response", hostVerificationRequired: true, notes: NOTES,
      },
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          node_id: { type: "string", minLength: 1, maxLength: 200, description: "The video clip (pr_get_sequence lists node_id)." },
          output_dir: { type: "string", minLength: 1, maxLength: 4096, description: "Folder for the timeline image (default: a temporary folder)." },
        },
        required: ["node_id"],
      },
      handler: async (args: Record<string, unknown>): Promise<CommandResult> => {
        let nodeId: string;
        try {
          nodeId = nodeIdOf(args);
        } catch (e) {
          return fail((e as Error).message);
        }
        const bridge = newBridge(nodeId);
        try {
          const d = await prepare();
          const ui = new TimeRemapUi(d, bridge);
          const r = await ui.inspect();
          if (!r.shown) return { success: true, data: { shown: false, clip: r.clip, note: "The clip does not show Time Remapping › Speed on the timeline under the playhead (or is out of view)." } };
          const img = await preview(d, r.preview!, outDir(args.output_dir), "time-remap-inspect.png");
          return {
            success: true,
            data: {
              shown: true, clip: { nodeId, name: r.clip.name, startSeconds: r.clip.start, endSeconds: r.clip.end },
              keyframeSeconds: r.keyframes, precisionFrames: r.precisionFrames, pxPerFrame: r.pxPerFrame,
              timelineImage: img.path, mimeType: "image/png", base64: img.base64,
            },
          };
        } catch (e) {
          if (e instanceof RemapUiError || e instanceof DesktopError) return fail(e.message);
          return fail(`Time Remapping inspection failed: ${(e as Error).message}`);
        }
      },
    },
  };
}

export { findKeyStrip, keyHandles };
