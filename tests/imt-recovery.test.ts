// IMT 1.0.4: refusals raised before any write are not_applied (no host-recovery lock);
// the facade tells the agent how to resume after an unknown outcome.
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { getHelpersSource } from "../src/bridge/script-builder.js";
import { mutationReceipt } from "../src/workflows/mutation-receipt.js";
import { withRecoveryHint } from "../src/product/facade.js";

function fail(body: string, undoIndexAfter: number | null = 5) {
  const qe = { project: { undoStackIndex: () => { if (undoIndexAfter === null) throw new Error("no QE"); return undoIndexAfter; } } };
  const out = runInNewContext(`${getHelpersSource()}\n${body}`, { app: { enableQE: () => {} }, qe });
  return JSON.parse(String(out)) as { success: boolean; error: string; data?: Record<string, unknown> };
}

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
