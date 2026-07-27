import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import {
  appServerEntryRule,
  browserRoleRules,
  restrictedImportRegexForRoleRule,
  restrictedServerImportRegexForAppRule,
  serverRoleRules,
  stableBrowserEntry,
} from "./test-utils/architecture/architecturePolicy.mjs";

const eslintConfig = defineConfig([
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
              regex: `^(?:\\.\\./)+browser/(?![^/]+/${stableBrowserEntry}$)`,
              message: "UI may import browser runtime only through stable controller APIs and their concrete factories."
            },
            {
              regex: `^@/browser/(?![^/]+/${stableBrowserEntry}$)`,
              message: "UI may import browser runtime only through stable controller APIs and their concrete factories."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/browser/*/browser*Controller.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
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
  ...browserRoleRules.map((rule) => ({
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
  ...serverRoleRules.map((rule) => ({
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
    files: [...appServerEntryRule.eslintFiles],
    ignores: ["src/app/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            regex: restrictedServerImportRegexForAppRule(appServerEntryRule),
            message: `[${appServerEntryRule.id}] ${appServerEntryRule.message}`
          }]
        }
      ]
    }
  },
]);

export default eslintConfig;
