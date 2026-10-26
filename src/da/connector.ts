// pr_install_connector — the Premiere side of the bridge (CEP extension MCPBridgeCEP) for people who
// installed the server as a Claude Desktop extension (.mcpb) and have no terminal: the agent checks
// it and, after the user agrees, installs it. Same installers as `premiere-mcp-imt --install-cep`
// (scripts/install-cep.sh / install-cep.ps1), but their output is CAPTURED — an MCP stdio server
// must never let a child process write to its stdout.
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/server";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export type ConnectorAction = "status" | "install";

/** Command for the platform's installer; null = unsupported platform. */
export function connectorCommand(
  action: ConnectorAction,
  platform: NodeJS.Platform = process.platform,
  root: string = ROOT,
): { cmd: string; args: string[] } | null {
  if (platform === "darwin") {
    return { cmd: "bash", args: [path.join(root, "scripts", "install-cep.sh"), action === "install" ? "--copy" : "--diagnose"] };
  }
  if (platform === "win32") {
    return {
      cmd: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "install-cep.ps1"), ...(action === "status" ? ["-Diagnose"] : [])],
    };
  }
  return null;
}

function runCaptured(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
      resolve({ code, out: `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim() });
    });
  });
}

export function connectorTool(): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<CallToolResult>;
} {
  return {
    name: "pr_install_connector",
    description:
      "The Premiere side of the bridge (CEP extension MCPBridgeCEP). action=status (default, read-only) says whether it is installed and enabled; " +
      "action=install copies it into the user's CEP extensions folder and enables unsigned CEP extensions (PlayerDebugMode) — ask the user first. " +
      "After an install the user must quit and reopen Premiere Pro, then call pr_verify. Use when pr_verify reports that the connector does not answer.",
    parameters: {
      type: "object",
      properties: { action: { type: "string", enum: ["status", "install"], default: "status" } },
    },
    run: async (args) => {
      const action: ConnectorAction = args.action === "install" ? "install" : "status";
      const c = connectorCommand(action);
      if (!c) {
        return { content: [{ type: "text", text: `The Premiere connector installer supports macOS and Windows only (this is ${process.platform}).` }], isError: true };
      }
      const r = await runCaptured(c.cmd, c.args);
      const next =
        action === "install" && r.code === 0
          ? "\n\nNext: the user quits Premiere Pro completely and opens it again; then call pr_verify."
          : action === "status" && r.code !== 0
            ? "\n\nThe connector is not ready. Ask the user, then call pr_install_connector {action:\"install\"}."
            : "";
      return { content: [{ type: "text", text: `${r.out || "(no output)"}${next}` }], ...(r.code === 0 ? {} : { isError: true }) };
    },
  };
}
