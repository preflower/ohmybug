import path from "node:path";

import { defineConfig } from "vite";

import { buildElectronSources, createElectronBootstrapPlugin } from "./vite.config.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  build: {
    outDir: path.resolve(repositoryRoot, ".vite/dev-bootstrap"),
    emptyOutDir: true,
  },
  plugins: [createElectronBootstrapPlugin({
    build: () => buildElectronSources(repositoryRoot),
    rendererUrl: (url) => { process.env.OMB_RENDERER_URL = url; },
  })],
});
