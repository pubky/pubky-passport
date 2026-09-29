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

const packageSource = "packages/passport-client/src";
function packageBoundaries({ sdk = false, react = false, vendor = false, core = false } = {}) {
  return restrictedImports(
    {
      regex: "^(?:@/|@test-utils/|next(?:/|$)|client-only$|server-only$|node:)",
      message: "The package must remain independent of app and server code.",
    },
    ...(!sdk
      ? [
          {
            regex: "^@synonymdev/pubky(?:/|$)",
            allowTypeImports: true,
            message: "SDK values belong in flow/pubkyFlowAdapter.ts.",
          },
        ]
      : []),
    ...(!react
      ? [{ regex: "^(?:react|react-dom)(?:/|$)", message: "React belongs in react.tsx." }]
      : []),
    ...(!vendor
      ? [
          {
            regex: "(?:^|/)vendor/qrcodegen(?:\\.js)?$",
            message: "The encoder belongs behind renderQrSvg.ts.",
          },
        ]
      : []),
    ...(core
      ? [
          {
            regex:
              "(?:^|/)(?:ui|qrcode)(?:/|$)|(?:^|/)(?:index|element|qr|react)(?:\\.js)?$|^@pubky/passport-client(?:/|$)",
            message: "Core modules must not import UI, QR code or entrypoints.",
          },
        ]
      : []),
  );
}

function packageImportRules(options) {
  return {
    ...importRules(packageBoundaries(options)),
    "@typescript-eslint/no-import-type-side-effects": "error",
  };
}

function importRules(imports) {
  return {
    "no-restricted-imports": imports,
    "no-restricted-syntax": [
      "error",
      ...imports[1].patterns.map(({ regex, message }) => ({
        selector: `ImportExpression[source.value=/${regex.replaceAll("/", "\\/")}/]`,
        message,
      })),
      {
        selector: 'ImportExpression[source.type!="Literal"]',
        message: "Dynamic imports use a string literal.",
      },
    ],
  };
}

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
  globalIgnores(["**/dist/**", "**/coverage/**", "**/.next/**"]),
  {
    files: [`src/${sourceFiles}`, `packages/${sourceFiles}`, `examples/${sourceFiles}`],
    rules: { "import/no-relative-packages": "error" },
  },
  ...[
    { files: [`${packageSource}/${sourceFiles}`], options: {} },
    { files: [`${packageSource}/react.tsx`], options: { react: true } },
    { files: [`${packageSource}/qrcode/renderQrSvg.ts`], options: { vendor: true } },
    {
      files: [
        `${packageSource}/{client,config,attempt,flow,popup,protocol,instance,errors,view,environment,shared}/${sourceFiles}`,
      ],
      options: { core: true },
    },
    // This adapter exception must follow the core block.
    { files: [`${packageSource}/flow/pubkyFlowAdapter.ts`], options: { sdk: true, core: true } },
  ].map(({ files, options }) => ({
    files,
    ignores: [`${packageSource}/${testFiles}`],
    rules: packageImportRules(options),
  })),
  {
    files: [`examples/**/src/${sourceFiles}`],
    ignores: [`examples/**/src/${testFiles}`],
    rules: importRules(
      restrictedImports({
        regex: "^(?:@/|@test-utils/|@pubky/passport-client/(?:src|dist)(?:/|$))",
        message: "Examples consume public package entrypoints only.",
      }),
    ),
  },
]);

export default ESLINT_CONFIG;
