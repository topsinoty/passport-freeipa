/**
 * Smoke tests against the built package in `dist/`.
 *
 * These run separately from the unit suite (`pnpm test:dist`) because they
 * require a build first. They check the things that only break after
 * bundling: that both module formats load, that they expose the same API,
 * and that the strategy still works when imported the way consumers import
 * it rather than from source.
 */

import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const distPath = (file: string): string =>
  fileURLToPath(new URL(`../../dist/${file}`, import.meta.url));

describe("built package", () => {
  it("emits every entrypoint and its declarations", () => {
    for (const file of [
      "index.js",
      "index.cjs",
      "index.d.ts",
      "index.d.cts",
    ]) {
      expect(existsSync(distPath(file)), `dist/${file} is missing`).toBe(true);
    }
  });

  it("exposes the same API from ESM and CommonJS", async () => {
    const esm = await import(distPath("index.js"));
    const cjs: Record<string, unknown> = require(distPath("index.cjs"));

    const expected = [
      "FreeipaStrategy",
      "Strategy",
      "FreeipaError",
      "createFreeipaClient",
      "firstValue",
      "allValues",
      "isCredentialRejection",
      "describeRejection",
    ];

    for (const name of expected) {
      expect(Object.keys(esm), `ESM is missing ${name}`).toContain(name);
      expect(Object.keys(cjs), `CJS is missing ${name}`).toContain(name);
    }
  });

  it("authenticates through the built ESM bundle", async () => {
    const { FreeipaStrategy } = await import(distPath("index.js"));

    const fetchStub = async (): Promise<Response> =>
      new Response("", {
        status: 200,
        headers: { "set-cookie": "ipa_session=abc123; Path=/ipa" },
      });

    const strategy = new FreeipaStrategy({
      freeipa: { server: "ipa.example.test", fetch: fetchStub },
    });

    expect(strategy.name).toBe("freeipa");
  });

  it("keeps Strategy as an alias of FreeipaStrategy in both formats", async () => {
    const esm = await import(distPath("index.js"));
    const cjs: Record<string, unknown> = require(distPath("index.cjs"));

    expect(esm.Strategy).toBe(esm.FreeipaStrategy);
    expect(cjs.Strategy).toBe(cjs.FreeipaStrategy);
  });
});
