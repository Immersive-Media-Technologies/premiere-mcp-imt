// GUI clients (Claude Desktop, Cursor) start the server with a minimal PATH on macOS, so `ffmpeg`
// from Homebrew is not found by the media-analysis operations. Append the usual install folders.
import path from "node:path";

const MAC_EXTRA = ["/opt/homebrew/bin", "/usr/local/bin"];

export function extendGuiPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== "darwin") return env.PATH;
  const parts = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of MAC_EXTRA) if (!parts.includes(dir)) parts.push(dir);
  env.PATH = parts.join(path.delimiter);
  return env.PATH;
}
