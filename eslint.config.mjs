import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import { STABLE_BROWSER_UI_ENTRIES } from "./test-utils/architecture/architectureEntries.mjs";

const STABLE_BROWSER_UI_ENTRY = `(?:${STABLE_BROWSER_UI_ENTRIES.join("|")})`;

const ESLINT_CONFIG = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "coverage/**",
    "test-utils/architecture/fixtures/**",
    "next-env.d.ts"
  ]),
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: ["src/libs/logger/logger.ts"],
    rules: {
      "no-console": "error"
    }
  },
  {
    files: ["src/client/ui/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "../browser/authorization/browserAuthorizationRequest",
              importNames: ["PubkyAuthApprovalCapability"],
              message: "UI must consume safe authorization controller state, not sensitive approval types."
            },
            {
              name: "@/client/browser/authorization/browserAuthorizationRequest",
              importNames: ["PubkyAuthApprovalCapability"],
              message: "UI must consume safe authorization controller state, not sensitive approval types."
            }
          ],
          patterns: [
            {
              regex: `^(?:\\.\\./)+browser/(?!${STABLE_BROWSER_UI_ENTRY}$)`,
              message: "UI may import browser runtime only through stable browser APIs and controller factories."
            },
            {
              regex: `^@/client/browser/(?!${STABLE_BROWSER_UI_ENTRY}$)`,
              message: "UI may import browser runtime only through stable browser APIs and controller factories."
            }
          ]
        }
      ]
    }
  },
  {
    files: [
      "src/client/browser/authorization/passportAuthorization.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
      "src/client/browser/authorization/browserManualAuthorization.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
      "src/client/browser/identity/passportIdentityController.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
    ],
    ignores: ["src/client/browser/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/client/browser/authorization/browserAuthorizationRequest",
              importNames: ["PubkyAuthApprovalCapability"],
              message: "Public browser contracts must expose safe review state, not sensitive approval types."
            }
          ],
          patterns: [{
            regex: "^(?:\\.\\./)+authorization/browserAuthorizationRequest$",
            importNames: ["PubkyAuthApprovalCapability"],
            message: "Public browser contracts must expose safe review state, not sensitive approval types."
          }]
        }
      ]
    }
  },
  {
    files: ["src/client/browser/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: ["src/client/browser/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            regex: "^(?:server-only$|@/server(?:/|$)|(?:\\.\\./)+server(?:/|$))",
            message: "Browser modules must not import server runtime code."
          }]
        }
      ]
    }
  },
  {
    files: ["src/server/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: ["src/server/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            regex: "^(?:client-only$|@/(?:client/browser|libs/env)(?:/|$)|(?:\\.\\./)+(?:client/browser|libs/env)(?:/|$))",
            message: "Server modules must not import browser runtime or public environment code."
          }]
        }
      ]
    }
  },
  {
    files: ["src/server/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: [
      "src/server/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
      "src/server/wrapping-key/google/googleWrappingKeyRequest.ts"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            regex: "^(?:@/server/config(?:/|$)|(?:\\.\\./)+config(?:/|$))",
            message: "Environment-backed configuration is confined to approved bootstrap modules."
          }]
        }
      ]
    }
  },
  {
    files: ["src/app/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: [
      "src/app/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
      "src/app/page.tsx",
      "src/app/authorize/page.tsx"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            regex: "^(?:@/server/config(?:/|$)|(?:\\.\\./)+server/config(?:/|$))",
            message: "Environment-backed browser bootstrap configuration is confined to approved app entries."
          }]
        }
      ]
    }
  },
  {
    files: ["src/app/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: [
      "src/app/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
      "src/app/api/wrapping-key/google/route.ts"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            regex: "(?:^|/)googleWrappingKeyRequest$",
            importNames: ["createConfiguredGoogleWrappingKeyRequest"],
            message: "The wrapping-key secret bootstrap is confined to its API route."
          }]
        }
      ]
    }
  },
]);

export default ESLINT_CONFIG;
