import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node20",
    platform: "node",
    splitting: false,
    treeshake: true,
    shims: true,
  },
  {
    entry: { cli: "src/cli/main.ts" },
    format: ["esm"],
    sourcemap: true,
    target: "node20",
    platform: "node",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
