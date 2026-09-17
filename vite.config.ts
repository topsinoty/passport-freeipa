import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import type { Plugin } from "vite";

/**
 * Emits `dist/index.d.cts` alongside the bundled `dist/index.d.ts`.
 *
 * TypeScript resolves `require()` types through `.d.cts`; without it, Node16
 * reports the CommonJS entrypoint as ESM types over a CJS file.
 */
const emitCjsTypes = (): Plugin => ({
  name: "emit-cjs-types",
  apply: "build",
  async closeBundle() {
    const dist = resolve(import.meta.dirname, "dist");
    await copyFile(resolve(dist, "index.d.ts"), resolve(dist, "index.d.cts"));
  },
});

/**
 * Library build: ESM and CommonJS from one pass, plus one bundled type
 * declaration.
 *
 * Declarations are rolled up so the published types carry no relative
 * imports, which keeps source files free of `./foo.js` extensions.
 */
export default defineConfig({
  plugins: [
    dts({
      bundleTypes: true,
      include: ["src"],
    }),
    emitCjsTypes(),
  ],
  build: {
    target: "node20",
    outDir: "dist",
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format === "cjs" ? "cjs" : "js"}`,
    },
    rollupOptions: {
      external: ["set-cookie-parser"],
    },
  },
});
