import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@test-utils": fileURLToPath(new URL("./test-utils", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "client-only": fileURLToPath(new URL("./test-utils/runtime-only-stub.ts", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test-utils/runtime-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/client/logic/pubky/**/*.staging.test.ts"],
    exclude: configDefaults.exclude,
    setupFiles: ["./test-utils/vitest-setup.ts"],
    silent: "passed-only",
    testTimeout: 180_000,
    hookTimeout: 30_000,
  },
});
