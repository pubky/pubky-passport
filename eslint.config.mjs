import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import {
  APP_SERVER_ENTRY_RULE,
  BROWSER_ROLE_RULES,
  restrictedImportRegexForRoleRule,
  restrictedServerImportRegexForAppRule,
  SERVER_ROLE_RULES,
  STABLE_BROWSER_ENTRY,
} from "./test-utils/architecture/architecturePolicy.mjs";

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
              regex: `^(?:\\.\\./)+browser/(?![^/]+/${STABLE_BROWSER_ENTRY}$)`,
              message: "UI may import browser runtime only through stable browser APIs and controller factories."
            },
            {
              regex: `^@/browser/(?![^/]+/${STABLE_BROWSER_ENTRY}$)`,
              message: "UI may import browser runtime only through stable browser APIs and controller factories."
            }
          ]
        }
      ]
    }
  },
  {
    files: [
      "src/browser/*/browser*Controller.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
      "src/browser/authorization/browserManualAuthorization.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
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
  ...BROWSER_ROLE_RULES.map((rule) => ({
    files: [...rule.eslintFiles],
    ignores: ["src/browser/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            regex: restrictedImportRegexForRoleRule(rule),
            message: `[${rule.id}] ${rule.message}`
          }]
        }
      ]
    }
  })),
  ...SERVER_ROLE_RULES.map((rule) => ({
    files: [...rule.eslintFiles],
    ignores: ["src/server/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            regex: restrictedImportRegexForRoleRule(rule),
            message: `[${rule.id}] ${rule.message}`
          }]
        }
      ]
    }
  })),
  {
    files: [...APP_SERVER_ENTRY_RULE.eslintFiles],
    ignores: ["src/app/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            regex: restrictedServerImportRegexForAppRule(APP_SERVER_ENTRY_RULE),
            message: `[${APP_SERVER_ENTRY_RULE.id}] ${APP_SERVER_ENTRY_RULE.message}`
          }]
        }
      ]
    }
  },
]);

export default ESLINT_CONFIG;
