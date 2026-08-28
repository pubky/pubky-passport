import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const sourceFiles = "**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}";
const testFiles = "**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}";
const sdkImport = {
  regex: "^@synonymdev/pubky$",
  message: "The Pubky SDK is confined to PubkySdkAdapter and intentional tests.",
};
const serverImport = {
  regex: "^(?:server-only$|@/server(?:/|$)|(?:\\.\\./)+server(?:/|$))",
  message: "Client modules must not import server runtime code.",
};
const clientImport = {
  regex: "^(?:client-only$|@/client(?:/|$)|(?:\\.\\./)+client(?:/|$))",
  message: "Server modules must not import client runtime code.",
};
const serverConfigImport = {
  regex: "^(?:@/server/config(?:/|$)|(?:\\.\\./)+(?:server/)?config(?:/|$))",
  message: "Environment-backed configuration is confined to approved bootstrap modules.",
};
const restrictedImports = (...patterns) => ["error", { patterns }];

const ESLINT_CONFIG = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
  {
    files: [sourceFiles],
    ignores: ["src/libs/logger/logger.ts"],
    rules: { "no-console": "error" },
  },
  {
    files: [`src/client/${sourceFiles}`],
    ignores: [`src/client/${testFiles}`, "src/client/logic/pubky/PubkySdkAdapter.ts"],
    rules: { "no-restricted-imports": restrictedImports(serverImport, sdkImport) },
  },
  {
    files: ["src/client/logic/pubky/PubkySdkAdapter.ts"],
    rules: { "no-restricted-imports": restrictedImports(serverImport) },
  },
  {
    files: [`src/server/${sourceFiles}`],
    ignores: [
      `src/server/${testFiles}`,
      "src/server/wrapping-key/google/GoogleWrappingKeyIssuer.ts",
    ],
    rules: {
      "no-restricted-imports": restrictedImports(clientImport, serverConfigImport, sdkImport),
    },
  },
  {
    files: ["src/server/wrapping-key/google/GoogleWrappingKeyIssuer.ts"],
    rules: { "no-restricted-imports": restrictedImports(clientImport, sdkImport) },
  },
  {
    files: [`src/libs/${sourceFiles}`],
    ignores: [`src/libs/${testFiles}`],
    rules: {
      "no-restricted-imports": restrictedImports(
        {
          regex:
            "^(?:client-only$|server-only$|@/(?:client|server)(?:/|$)|(?:\\.\\./)+(?:client|server)(?:/|$))",
          message: "Shared modules must remain independent from client and server runtimes.",
        },
        sdkImport,
      ),
    },
  },
  {
    files: [`src/app/${sourceFiles}`],
    ignores: [`src/app/${testFiles}`, "src/app/layout.tsx"],
    rules: { "no-restricted-imports": restrictedImports(serverConfigImport, sdkImport) },
  },
  {
    files: ["src/app/layout.tsx", "src/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: ["src/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: { "no-restricted-imports": restrictedImports(sdkImport) },
  },
]);

export default ESLINT_CONFIG;
