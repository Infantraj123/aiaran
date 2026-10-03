// Validates the publishable package: version sync, exports, bin, and that no
// test fixtures or sources leak into the tarball.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const versionTs = readFileSync(new URL("../src/version.ts", import.meta.url), "utf8");
const errors = [];

if (!versionTs.includes(`"${pkg.version}"`))
  errors.push(`src/version.ts does not match package.json version ${pkg.version}`);

const packed = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }),
)[0];
const files = packed.files.map((f) => f.path);
for (const required of [
  "dist/index.js",
  "dist/index.cjs",
  "dist/index.d.ts",
  "dist/index.d.cts",
  "dist/cli.js",
  "README.md",
  "LICENSE",
  "SECURITY.md",
]) {
  if (!files.includes(required)) errors.push(`missing from package: ${required}`);
}
for (const f of files) {
  if (/^(src|tests|test-fixtures|scripts|examples)\//.test(f))
    errors.push(`unexpected file in package: ${f}`);
}

const esm = await import("../dist/index.js");
if (typeof esm.Aran !== "function") errors.push("ESM export Aran missing");
const { createRequire } = await import("node:module");
const cjs = createRequire(import.meta.url)("../dist/index.cjs");
if (typeof cjs.Aran !== "function") errors.push("CJS export Aran missing");
const cli = readFileSync(new URL("../dist/cli.js", import.meta.url), "utf8");
if (!cli.startsWith("#!/usr/bin/env node")) errors.push("CLI is missing its shebang");

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  process.exit(1);
}
console.log(
  `✓ ${pkg.name}@${pkg.version}: ${files.length} files, ${(packed.size / 1024).toFixed(0)} KB packed`,
);
