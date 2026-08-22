import { resolve } from "node:path";

import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "../../..");

await build({
  entryPoints: [resolve(projectRoot, "apps/desktop/src/electron/preload.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: resolve(projectRoot, ".vite/build/apps/desktop/src/electron/preload.cjs"),
  logLevel: "info",
});
