// IMT 1.1.0: refusals raised before any write are not_applied (no host-recovery lock);
// the facade tells the agent how to resume after an unknown outcome.
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildScript, getHelpersSource } from "../src/bridge/script-builder.js";
import { mutationReceipt } from "../src/workflows/mutation-receipt.js";
import { withRecoveryHint } from "../src/product/facade.js";

function fail(body: string, undoIndexAfter: number | null = 5, project?: Record<string, unknown>) {
  const qe = { project: { undoStackIndex: () => { if (undoIndexAfter === null) throw new Error("no QE"); return undoIndexAfter; } } };
  const out = runInNewContext(`${getHelpersSource()}\n${body}`, { app: { enableQE: () => {}, project }, qe });
  return JSON.parse(String(out)) as { success: boolean; error: string; data?: Record<string, unknown> };
}

// Premiere's home screen: app.project is a placeholder object without a root bin.
const HOME_SCREEN = { name: "", path: "", documentID: "", rootItem: null };
const OPEN_PROJECT = { name: "Edit.prproj", path: "/p/Edit.prproj", documentID: "d1", rootItem: { children: { numItems: 0 } } };

describe("pre-write refusals", () => {
  it("marks an explicit pre-write refusal with an unchanged undo index not_applied", () => {
    const r = fail(`__undoStart = 5; __error("Effect not found; nothing was changed.")`);
    expect(r.data).toMatchObject({ mutationOutcome: "not_applied", refusedBeforeWrite: true });
    expect(mutationReceipt(false, r.data, { dispatched: true }).outcome).toBe("not_applied");
  });
  it("keeps the outcome unknown when Premiere recorded undo entries", () => {
    const r = fail(`__undoStart = 5; __error("Effect not found; nothing was changed.")`, 6);
    expect(r.data?.mutationOutcome).toBeUndefined();
    expect(mutationReceipt(false, r.data, { dispatched: true }).outcome).toBe("unknown");
  });
  it("keeps the outcome unknown when the undo index cannot be read", () => {
    const r = fail(`__undoStart = 5; __error("Clip not found; nothing was changed.")`, null);
    expect(mutationReceipt(false, r.data, { dispatched: true }).outcome).toBe("unknown");
  });
  it("keeps the outcome unknown for a failure that does not say nothing was changed", () => {
    const r = fail(`__undoStart = 5; __error("Premiere rejected the write")`);
    expect(mutationReceipt(false, r.data, { dispatched: true }).outcome).toBe("unknown");
  });
  it("keeps the outcome unknown without undo tracking (inspect calls) or after a marker write", () => {
    expect(fail(`__undoStart = null; __error("Clip not found; nothing was changed.")`).data).toBeUndefined();
    const marker = fail(`__undoStart = 5; __markerWriteAttempted = true; __error("Marker not found; nothing was changed.")`);
    expect(marker.data?.mutationOutcome).toBe("unknown");
  });
  it("never overrides an outcome the command reported itself", () => {
    const r = fail(`__undoStart = 5; __error("Partly applied; nothing was changed on the second clip.", { outcome: "committed_unverified", timelineChanged: true })`);
    expect(r.data).toMatchObject({ outcome: "committed_unverified" });
    expect(r.data?.mutationOutcome).toBeUndefined();
  });
});

describe("no project open (Premiere home screen)", () => {
  it("tells a placeholder project from a real one", () => {
    const open = (project?: Record<string, unknown>) =>
      runInNewContext(`${getHelpersSource()}\n__projectIsOpen()`, { app: { enableQE: () => {}, project } });
    expect(open(HOME_SCREEN)).toBe(false);
    expect(open(undefined)).toBe(false);
    expect(open(OPEN_PROJECT)).toBe(true);
  });
  it("makes an edit refused on the home screen not_applied and says how to go on", () => {
    const r = fail(`__undoStart = 0; __projectOpenAtStart = false; __error("No project is open")`, 0, HOME_SCREEN);
    expect(r.error).toMatch(/^No project is open: Premiere is on its home screen\. Open or create a project first .*nothing was changed\.$/);
    expect(r.data).toMatchObject({ mutationOutcome: "not_applied", refusedBeforeWrite: true, noProjectOpen: true });
    expect(mutationReceipt(false, r.data, { dispatched: true }).outcome).toBe("not_applied");
  });
  it("keeps Premiere's own error and adds the reason for a script that hit the empty project", () => {
    const r = fail(`__undoStart = 0; __projectOpenAtStart = false; __error("TypeError: null is not an object")`, 0, HOME_SCREEN);
    expect(r.error).toMatch(/^TypeError: null is not an object \(No project is open: .*nothing was changed\.\)$/);
    expect(mutationReceipt(false, r.data, { dispatched: true }).outcome).toBe("not_applied");
  });
  it("adds the reason to a refusal that was already not_applied", () => {
    const r = fail(`__undoStart = 0; __projectOpenAtStart = false; __error("Clip not found; nothing was changed.")`, 0, HOME_SCREEN);
    expect(r.error).toContain("home screen");
    expect(r.data).toMatchObject({ mutationOutcome: "not_applied", noProjectOpen: true });
  });
  it("rewords a read on the home screen without inventing a mutation receipt", () => {
    const r = fail(`__undoStart = null; __projectOpenAtStart = false; __error("No project is open")`, 0, HOME_SCREEN);
    expect(r.error).toContain("Open or create a project first");
    expect(r.data).toBeUndefined();
  });
  it("stays unknown when a project was open at the start, opened during the command, or a marker write was attempted", () => {
    const wasOpen = fail(`__undoStart = 0; __projectOpenAtStart = true; __error("TypeError: null is not an object")`, 0, HOME_SCREEN);
    expect(wasOpen.error).toBe("TypeError: null is not an object");
    expect(mutationReceipt(false, wasOpen.data, { dispatched: true }).outcome).toBe("unknown");
    const nowOpen = fail(`__undoStart = 0; __projectOpenAtStart = false; __error("Import failed")`, 0, OPEN_PROJECT);
    expect(mutationReceipt(false, nowOpen.data, { dispatched: true }).outcome).toBe("unknown");
    const marker = fail(`__undoStart = 0; __projectOpenAtStart = false; __markerWriteAttempted = true; __error("x")`, 0, HOME_SCREEN);
    expect(marker.data?.mutationOutcome).toBe("unknown");
    const recorded = fail(`__undoStart = 0; __projectOpenAtStart = false; __error("second write failed")`, 2, HOME_SCREEN);
    expect(recorded.error).not.toContain("home screen");
    expect(mutationReceipt(false, recorded.data, { dispatched: true }).outcome).toBe("unknown");
  });
  it("records the project state before any guard and clears it after the command", () => {
    const script = buildScript(`return __result({});`);
    const mark = "__projectOpenAtStart = typeof __projectIsOpen === \"function\" ? __projectIsOpen() : null;";
    expect(script.indexOf(mark)).toBeGreaterThan(-1);
    expect(script.indexOf(mark)).toBeLessThan(script.indexOf("__undoStart ="));
    expect(script).toMatch(/finally \{\s*__projectOpenAtStart = null;/);
  });
});

describe("facade recovery hint", () => {
  it("explains how to resume when edits are paused", () => {
    const r = withRecoveryHint({ content: [{ type: "text", text: "Error: HOST_RECOVERY_REQUIRED: inspect current Premiere state" }], isError: true });
    expect(r.content.at(-1)).toMatchObject({ type: "text", text: expect.stringContaining("acknowledge_operation_recovery") });
  });
  it("warns after an edit with an unknown outcome", () => {
    const r = withRecoveryHint({ content: [{ type: "text", text: "Error: write failed" }], isError: true, structuredContent: { receipt: { outcome: "unknown" } } });
    expect(r.content.at(-1)).toMatchObject({ text: expect.stringContaining("further edits are paused") });
  });
  it("leaves successes and refusals before a write alone", () => {
    const ok = { content: [{ type: "text" as const, text: "{}" }] };
    expect(withRecoveryHint(ok)).toBe(ok);
    const refused = { content: [{ type: "text" as const, text: "Error: Clip not found; nothing was changed." }], isError: true, structuredContent: { receipt: { outcome: "not_applied" } } };
    expect(withRecoveryHint(refused)).toBe(refused);
  });
});
