import { defineConfig } from "vitest/config";

/**
 * Two projects: `unit` runs against `src/`, `dist` smoke-tests the built
 * package and therefore requires `vite build` first.
 *
 * A bare `vitest run` runs both, so the scripts pin a project.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary", "lcov"],
    },
    projects: [
      {
        test: {
          name: "unit",
          root: import.meta.dirname,
          include: ["test/**/*.test.ts"],
          exclude: ["test/dist/**"],
          environment: "node",
        },
      },
      {
        test: {
          name: "dist",
          root: import.meta.dirname,
          include: ["test/dist/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
