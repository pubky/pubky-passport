import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "client-only": fileURLToPath(new URL("./test-utils/runtime-only-stub.ts", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test-utils/runtime-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    coverage: {
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.staging.test.ts"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      provider: "v8",
      reporter: ["text-summary", "html"],
      thresholds: {
        lines: 85,
      },
    },
    environment: "node",
    globals: false,
    include: ["*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: [...configDefaults.exclude, "src/**/*.staging.test.ts"],
    setupFiles: ["./test-utils/vitest-setup.ts"],
    silent: "passed-only",
  },
});
