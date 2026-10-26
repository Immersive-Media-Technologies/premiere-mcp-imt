#!/usr/bin/env node
// Release tag ↔ versioned files of PR-MCP-IMT. RELEASE_TAG must be v<package.json version>, and every
// distributable manifest must carry that version (the .mcpb manifest gets it at pack time).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const readJson = (path) => JSON.parse(read(path));
const version = readJson("package.json").version;
const tag = process.env.RELEASE_TAG;
const expectedTag = `v${version}`;

if (tag !== expectedTag) {
  throw new Error(`Release tag must be exactly ${expectedTag}; received ${tag || "(missing)"}`);
}

if (readJson("uxp-plugin/manifest.json").version !== version) {
  throw new Error(`uxp-plugin/manifest.json does not match package version ${version}`);
}
for (const manifest of ["cep-plugin/CSXS/manifest.xml", "after-effects-cep-plugin/CSXS/manifest.xml"]) {
  if (!read(manifest).includes(`ExtensionBundleVersion="${version}"`)) {
    throw new Error(`${manifest} bundle version does not match package version ${version}`);
  }
}
if (!read("cep-plugin/updater.cjs").includes(`CURRENT_VERSION = "${version}"`)) {
  throw new Error(`cep-plugin/updater.cjs CURRENT_VERSION does not match package version ${version}`);
}

console.log(`Release tag and distributable manifests verified for ${expectedTag}`);
