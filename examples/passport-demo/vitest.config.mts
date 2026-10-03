import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests never read a developer's .env files: they run with the demo's built-in defaults.
  envDir: false,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text-summary"],
    },
  },
});
