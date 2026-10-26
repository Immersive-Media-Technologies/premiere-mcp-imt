// Build the Claude Desktop extension (.mcpb) from the compiled server.
//   npm run build:mcpb  →  release/premiere-mcp-imt-<version>.mcpb (+ premiere-mcp-imt.mcpb)
// The bundle carries dist/, the Premiere connector (cep-plugin + its installers), production
// node_modules, the Premiere skill, LICENSE, NOTICE, THIRD-PARTY-NOTICES and the manifest from
// mcpb/. Packed with @anthropic-ai/mcpb, which validates the manifest.
import { execSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGING = join(ROOT, ".mcpb-staging");
const SERVER_DIR = join(STAGING, "server");
const RELEASE_DIR = join(ROOT, "release");
const run = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: "inherit" });

if (!process.env.MCPB_SKIP_BUILD) run("npm run build");
if (!existsSync(join(ROOT, "dist", "index.js"))) throw new Error("dist/index.js missing — run npm run build");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
rmSync(STAGING, { recursive: true, force: true });
mkdirSync(SERVER_DIR, { recursive: true });
mkdirSync(RELEASE_DIR, { recursive: true });

const manifest = JSON.parse(readFileSync(join(ROOT, "mcpb", "manifest.json"), "utf8"));
manifest.version = pkg.version;
// Claude Desktop shows display_name but not version — the version goes into the name.
if (!manifest.display_name.includes(pkg.version)) manifest.display_name = `${manifest.display_name} · v${pkg.version}`;
writeFileSync(join(STAGING, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
copyFileSync(join(ROOT, "mcpb", "icon.png"), join(STAGING, "icon.png"));

cpSync(join(ROOT, "dist"), join(SERVER_DIR, "dist"), { recursive: true });
cpSync(join(ROOT, "cep-plugin"), join(SERVER_DIR, "cep-plugin"), { recursive: true });
mkdirSync(join(SERVER_DIR, "scripts"), { recursive: true });
for (const f of ["install-cep.sh", "install-cep.ps1", "uninstall-cep.sh", "uninstall-cep.ps1"])
  copyFileSync(join(ROOT, "scripts", f), join(SERVER_DIR, "scripts", f));
for (const f of ["LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.md", "README.md"])
  if (existsSync(join(ROOT, f))) copyFileSync(join(ROOT, f), join(STAGING, f));
// pr_skill reads <package root>/skills/pr; in the bundle the package root is server/.
cpSync(join(ROOT, "skills", "pr"), join(SERVER_DIR, "skills", "pr"), { recursive: true });

writeFileSync(
  join(SERVER_DIR, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      type: pkg.type ?? "module",
      main: "dist/index.js",
      license: pkg.license,
      engines: pkg.engines,
      dependencies: pkg.dependencies ?? {},
    },
    null,
    2,
  ) + "\n",
);
console.log("Installing production dependencies into the bundle…");
run("npm install --omit=dev --no-audit --no-fund --no-package-lock", SERVER_DIR);

const outFile = join(RELEASE_DIR, `${manifest.name}-${pkg.version}.mcpb`);
const stableFile = join(RELEASE_DIR, `${manifest.name}.mcpb`);
rmSync(outFile, { force: true });
rmSync(stableFile, { force: true });
run(`npx -y @anthropic-ai/mcpb validate "${join(STAGING, "manifest.json")}"`);
run(`npx -y @anthropic-ai/mcpb pack "${STAGING}" "${outFile}"`);
copyFileSync(outFile, stableFile);
rmSync(STAGING, { recursive: true, force: true });
console.log(`MCPB ready: ${outFile}\n            ${stableFile}`);
