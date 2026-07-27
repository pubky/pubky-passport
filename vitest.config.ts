import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "client-only": fileURLToPath(new URL("./test-utils/client-only-stub.ts", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test-utils/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "test-utils/**/*.test.ts"],
    setupFiles: ["./test-utils/vitest-setup.ts"],
    silent: "passed-only",
  },
});
