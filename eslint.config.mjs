import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const sourceFiles = "**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}";
const testFiles = "**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}";
const sdkImport = {
  regex: "^@synonymdev/pubky$",
  message: "The Pubky SDK is confined to PubkySdkAdapter and intentional tests.",
};
const specsImport = {
  regex: "^pubky-app-specs(?:/|$)",
  message: "pubky-app-specs is confined to ProfileSpecsAdapter and intentional tests.",
};
// no-restricted-imports does not see `import()`, which is how the WASM package is loaded.
const specsDynamicImport = {
  selector: "ImportExpression[source.value=/^pubky-app-specs(\\/|$)/]",
  message: specsImport.message,
};
const serverImport = {
  regex: "^(?:server-only$|@/server(?:/|$)|(?:\\.\\./)+server(?:/|$))",
  message: "Client modules must not import server runtime code.",
};
const clientImport = {
  regex: "^(?:client-only$|@/client(?:/|$)|(?:\\.\\./)+client(?:/|$))",
  message: "Server modules must not import client runtime code.",
};
const serverEnvironmentImport = {
  regex: "^(?:@/server/environment$|(?:\\.\\.?/)+(?:server/)?environment$)",
  message: "Environment-backed configuration is confined to approved bootstrap modules.",
};
const clientEntrypointImport = {
  regex: "^(?:@/instrumentation-client$|(?:\\.\\./)+instrumentation-client$)",
  message: "Client logic must not import the Next.js client entrypoint.",
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
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parserOptions: { project: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { "@typescript-eslint/return-await": ["error", "in-try-catch"] },
  },
  {
    files: [sourceFiles],
    ignores: ["src/libs/logger/logger.ts"],
    rules: { "no-console": "error" },
  },
  {
    files: [`src/client/${sourceFiles}`],
    ignores: [
      `src/client/${testFiles}`,
      "src/client/logic/pubky/PubkySdkAdapter.ts",
      "src/client/logic/profile/ProfileSpecsAdapter.ts",
    ],
    rules: { "no-restricted-imports": restrictedImports(serverImport, sdkImport, specsImport) },
  },
  {
    files: [`src/client/logic/${sourceFiles}`],
    ignores: [
      `src/client/logic/${testFiles}`,
      "src/client/logic/pubky/PubkySdkAdapter.ts",
      "src/client/logic/profile/ProfileSpecsAdapter.ts",
    ],
    rules: {
      "no-restricted-imports": restrictedImports(
        serverImport,
        sdkImport,
        specsImport,
        clientEntrypointImport,
      ),
    },
  },
  {
    files: ["src/client/logic/pubky/PubkySdkAdapter.ts"],
    rules: {
      "no-restricted-imports": restrictedImports(serverImport, specsImport, clientEntrypointImport),
    },
  },
  {
    files: ["src/client/logic/profile/ProfileSpecsAdapter.ts"],
    rules: {
      "no-restricted-imports": restrictedImports(serverImport, sdkImport, clientEntrypointImport),
    },
  },
  {
    files: [`src/server/${sourceFiles}`],
    ignores: [
      `src/server/${testFiles}`,
      "src/server/wrapping-key/google/GoogleWrappingKeyIssuer.ts",
    ],
    rules: {
      "no-restricted-imports": restrictedImports(
        clientImport,
        serverEnvironmentImport,
        sdkImport,
        specsImport,
      ),
    },
  },
  {
    files: ["src/server/wrapping-key/google/GoogleWrappingKeyIssuer.ts"],
    rules: { "no-restricted-imports": restrictedImports(clientImport, sdkImport, specsImport) },
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
        specsImport,
      ),
    },
  },
  {
    files: [`src/app/${sourceFiles}`],
    ignores: [`src/app/${testFiles}`, "src/app/layout.tsx"],
    rules: {
      "no-restricted-imports": restrictedImports(serverEnvironmentImport, sdkImport, specsImport),
    },
  },
  {
    files: ["src/app/layout.tsx", "src/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: ["src/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: { "no-restricted-imports": restrictedImports(sdkImport, specsImport) },
  },
  {
    files: [`src/${sourceFiles}`],
    ignores: [`src/${testFiles}`, "src/client/logic/profile/ProfileSpecsAdapter.ts"],
    rules: { "no-restricted-syntax": ["error", specsDynamicImport] },
  },
]);

export default ESLINT_CONFIG;
