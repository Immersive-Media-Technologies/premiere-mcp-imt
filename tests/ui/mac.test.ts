import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { encodeBmp, parseBmp } from "../../src/ui/image.js";
import { DesktopError, type Exec, JXA, KEYCODES, MacDesktop, defaultExec } from "../../src/ui/mac.js";

const work = mkdtempSync(join(tmpdir(), "mac-desktop-test-"));
const shot = { w: 8, h: 4, data: new Uint8Array(8 * 4 * 3).fill(90) };

interface Call { file: string; args: string[] }

function fake(answers: Partial<Record<string, string | Error>> = {}) {
  const calls: Call[] = [];
  const exec: Exec = async (file, args) => {
    calls.push({ file, args });
    const fail = (key: string) => {
      const a = answers[key];
      if (a instanceof Error) throw a;
      return a;
    };
    if (file.endsWith("osascript")) {
      const cmd = args[4];
      const a = fail(cmd);
      if (a !== undefined) return { stdout: a, stderr: "" };
      if (cmd === "trusted") return { stdout: '{"trusted":true}\n', stderr: "" };
      if (cmd === "front") return { stdout: '{"activated":"Adobe Premiere Pro 2026"}', stderr: "" };
      if (cmd === "window") return { stdout: '{"x":100,"y":50,"w":4,"h":2,"name":"Project"}', stderr: "" };
      return { stdout: cmd, stderr: "" };
    }
    if (file.endsWith("screencapture")) {
      fail("screencapture");
      return { stdout: "", stderr: "" };
    }
    // sips
    const a = fail(args.includes("-g") ? "sips-size" : "sips");
    if (args.includes("-g")) return { stdout: a ?? `/x.png\n  pixelWidth: 1920\n  pixelHeight: 1080\n`, stderr: "" };
    const out = args[args.indexOf("--out") + 1];
    if (args.includes("bmp")) writeFileSync(out, encodeBmp(shot));
    else writeFileSync(out, "png");
    return { stdout: "", stderr: "" };
  };
  return { calls, exec };
}

function err(stderr: string): Error {
  return Object.assign(new Error("Command failed"), { stderr });
}

describe("MacDesktop", () => {
  it("checks Accessibility, activates Premiere and captures its window", async () => {
    const f = fake();
    const d = new MacDesktop(f.exec, work);
    d.sleep = async () => {};
    await d.checkAccess();
    expect(await d.front()).toBe("Adobe Premiere Pro 2026");
    const cap = await d.capture();
    expect(cap.scale).toBe(2); // 8 px wide capture of a 4 pt window
    expect(cap.origin).toEqual({ x: 100, y: 50 });
    const sc = f.calls.find((c) => c.file.endsWith("screencapture"))!;
    expect(sc.args.slice(0, 3)).toEqual(["-x", "-R", "100,50,4,2"]);
    expect(f.calls[0].args.slice(0, 3)).toEqual(["-l", "JavaScript", "-e"]);
    expect(f.calls[0].args[3]).toBe(JXA);
  });

  it("snaps the capture scale to the backing scale only when it is within 1 %", async () => {
    const snapped = await new MacDesktop(fake({ window: '{"x":0,"y":0,"w":4.02,"h":2,"name":""}' }).exec, work).capture();
    expect(snapped.scale).toBe(2);
    const raw = await new MacDesktop(fake({ window: '{"x":0,"y":0,"w":3,"h":2,"name":""}' }).exec, work).capture();
    expect(raw.scale).toBeCloseTo(8 / 3, 6);
  });

  it("posts events in screen points (capture pixels / scale + window origin)", async () => {
    const f = fake();
    const d = new MacDesktop(f.exec, work);
    await expect(d.click(1, 1)).rejects.toThrow(/no capture yet/);
    await d.capture();
    await d.click(4, 2, ["cmd"]);
    await d.move(1, 1);
    await d.drag([{ x: 0, y: 0 }, { x: 2, y: 2 }]);
    await d.key("cmd+alt+o");
    await d.type("12.5");
    const js = f.calls.filter((c) => c.file.endsWith("osascript")).map((c) => c.args.slice(4));
    expect(js).toContainEqual(["click", "102", "51", "cmd"]);
    expect(js).toContainEqual(["move", "100.5", "50.5"]);
    expect(js).toContainEqual(["path", "100", "50", "101", "51"]);
    expect(js).toContainEqual(["key", "cmd+alt+o", String(KEYCODES.o)]);
    expect(js).toContainEqual(["type", "12.5"]);
    await expect(d.drag([{ x: 0, y: 0 }])).rejects.toThrow(/at least two points/);
    await expect(d.key("cmd+q")).rejects.toThrow(/unknown key/);
  });

  it("explains missing permissions and other failures", async () => {
    await expect(new MacDesktop(fake({ trusted: '{"trusted":false}' }).exec, work).checkAccess()).rejects.toThrow(/Accessibility permission is missing/);
    await expect(new MacDesktop(fake({ screencapture: err("could not create image from rect") }).exec, work).capture()).rejects.toThrow(/Screen Recording permission/);
    await expect(new MacDesktop(fake({ screencapture: err("disk full") }).exec, work).capture()).rejects.toThrow(/screencapture failed: disk full/);
    await expect(new MacDesktop(fake({ front: '{"error":"Premiere Pro is not running"}' }).exec, work).front()).rejects.toThrow("Premiere Pro is not running");
    await expect(new MacDesktop(fake({ front: "{}" }).exec, work).front()).rejects.toThrow("could not activate Premiere Pro");
    await expect(new MacDesktop(fake({ window: '{"error":"no Premiere window on screen"}' }).exec, work).window()).rejects.toThrow(/Stage Manager/);
    await expect(new MacDesktop(fake({ window: '{"x":0,"y":0,"w":0,"h":0}' }).exec, work).window()).rejects.toThrow(/no Premiere window/);
    await expect(new MacDesktop(fake({ trusted: "garbage" }).exec, work).checkAccess()).rejects.toThrow(/unexpected osascript output: garbage/);
    await expect(new MacDesktop(fake({ trusted: err("execution error: -1743") }).exec, work).checkAccess()).rejects.toThrow(/osascript failed: execution error: -1743/);
    await expect(new MacDesktop(fake({ trusted: new Error("spawn ENOENT") }).exec, work).checkAccess()).rejects.toThrow(/osascript failed: spawn ENOENT/);
    const e = await new MacDesktop(fake({ sips: err("bad file") }).exec, work).decode("/x.jpg").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DesktopError);
    expect(String(e)).toMatch(/sips could not read \/x.jpg: bad file/);
  });

  it("reads image sizes, decodes with a width cap and writes PNGs", async () => {
    const f = fake();
    const d = new MacDesktop(f.exec, work);
    expect(await d.imageSize("/x.png")).toEqual({ w: 1920, h: 1080 });
    const img = await d.decode("/x.png", 800);
    expect([img.w, img.h]).toEqual([8, 4]);
    expect(f.calls.at(-1)!.args.slice(0, 2)).toEqual(["--resampleWidth", "800"]);
    const out = join(work, "o.png");
    expect(await d.savePng(shot, out, 4)).toBe(out);
    expect(f.calls.at(-1)!.args.slice(0, 2)).toEqual(["--resampleWidth", "4"]);
    await d.savePng(shot, out);
    expect(f.calls.at(-1)!.args[0]).toBe("-s");
    expect(readFileSync(out, "utf8")).toBe("png");
    await expect(new MacDesktop(fake({ "sips-size": "nothing" }).exec, work).imageSize("/x")).rejects.toThrow("not an image: /x");
    await expect(new MacDesktop(fake({ "sips-size": err("no such file") }).exec, work).imageSize("/x")).rejects.toThrow(/sips could not read \/x: no such file/);
  });

  it("runs real processes through defaultExec and sleeps", async () => {
    const r = await defaultExec(process.execPath, ["-e", "process.stdout.write('ok')"], 10_000);
    expect(r.stdout).toBe("ok");
    const e = await defaultExec(process.execPath, ["-e", "process.stderr.write('bad'); process.exit(3)"], 10_000).catch((x: unknown) => x);
    expect((e as { stderr: string }).stderr).toBe("bad");
    const t0 = Date.now();
    await new MacDesktop(fake().exec, work).sleep(20);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
    expect(parseBmp(encodeBmp(shot)).data).toEqual(shot.data);
  });
});
