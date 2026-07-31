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
    files: ["src/core/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "next",
                "next/*",
                "react",
                "react/*",
                "@synonymdev/pubky",
                "google-auth-library",
                "google-auth-library/*",
                "googleapis",
                "googleapis/*",
                "server-only",
                "client-only",
                "@/app/*",
                "@/ui/*",
                "@/browser/*",
                "@/server/*",
                "@/libs/*"
              ],
              message: "Core modules must stay framework-, runtime-, and infrastructure-independent."
            }
          ]
        }
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "window",
            message: "Core modules must not access browser globals. Use a runtime dependency instead."
        },
        {
          name: "document",
            message: "Core modules must not access browser globals. Use a runtime dependency instead."
        },
        {
          name: "localStorage",
            message: "Core modules must not access browser storage. Use a runtime dependency instead."
        },
        {
          name: "process",
            message: "Core modules must not read runtime environment. Pass validated values as inputs."
        }
      ]
    }
  },
  {
    files: ["src/ui/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "../core/auth/parsePubkyAuthRequest",
              importNames: ["ValidatedSensitivePubkyAuthRequest"],
              message: "UI must consume safe authorization controller state, not sensitive parser approval types."
            },
            {
              name: "@/core/auth/parsePubkyAuthRequest",
              importNames: ["ValidatedSensitivePubkyAuthRequest"],
              message: "UI must consume safe authorization controller state, not sensitive parser approval types."
            }
          ],
          patterns: [
            {
              regex: `^(?:\\.\\./)+browser/(?!${STABLE_BROWSER_UI_ENTRY}$)`,
              message: "UI may import browser runtime only through stable browser APIs and controller factories."
            },
            {
              regex: `^@/browser/(?!${STABLE_BROWSER_UI_ENTRY}$)`,
              message: "UI may import browser runtime only through stable browser APIs and controller factories."
            }
          ]
        }
      ]
    }
  },
  {
    files: [
      "src/browser/authorization/browserAuthorizationController.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
      "src/browser/authorization/createBrowserAuthorizationController.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
      "src/browser/authorization/browserManualAuthorization.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
      "src/browser/identity/passportIdentity.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
    ],
    ignores: ["src/browser/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/core/auth/parsePubkyAuthRequest",
              importNames: ["ValidatedSensitivePubkyAuthRequest"],
              message: "Public browser contracts must expose safe review state, not sensitive parser approval types."
            }
          ],
          patterns: [{
            regex: "^(?:\\.\\./)+core/auth/parsePubkyAuthRequest$",
            importNames: ["ValidatedSensitivePubkyAuthRequest"],
            message: "Public browser contracts must expose safe review state, not sensitive parser approval types."
          }]
        }
      ]
    }
  },
  {
    files: ["src/browser/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: ["src/browser/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
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
            regex: "^(?:client-only$|@/(?:browser|libs/env)(?:/|$)|(?:\\.\\./)+(?:browser|libs/env)(?:/|$))",
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
      "src/server/wrapping-key/google/composition/createConfiguredGoogleWrappingKeyRequest.ts"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            regex: "^(?:@/server/config(?:/|$)|(?:\\.\\./)+config(?:/|$)|.*googleWrappingKeyServerSecret$)",
            message: "Environment-backed configuration and wrapping-key secret parsing are confined to approved bootstrap modules."
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
            regex: "(?:^|/)createConfiguredGoogleWrappingKeyRequest$",
            message: "The wrapping-key secret bootstrap is confined to its API route."
          }]
        }
      ]
    }
  },
]);

export default ESLINT_CONFIG;
