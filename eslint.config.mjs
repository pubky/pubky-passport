import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const browserControllerContract = "browser[A-Z][A-Za-z0-9]*Controller";
const browserControllerFactory = "createBrowser[A-Z][A-Za-z0-9]*Controller";
const browserControllerImplementation = "passport[A-Z][A-Za-z0-9]*Controller";
const stableBrowserEntry = `(?:${browserControllerContract}|${browserControllerFactory})`;
const anyBrowserController = `(?:${browserControllerContract}|${browserControllerFactory}|${browserControllerImplementation})`;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts"
  ]),
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    ignores: ["src/libs/logger/logger.ts"],
    rules: {
      "no-console": "error"
    }
  },
  {
    files: ["src/core/**/*.{ts,tsx}"],
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
    files: ["src/ui/**/*.{ts,tsx}"],
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
    files: ["src/browser/**/application/**/*.{ts,tsx}"],
    ignores: ["src/browser/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: `(?:^|/)(?:adapters|composition|env)(?:/|$)|(?:^|/)${anyBrowserController}$|(?:^|/)ui(?:/|$)`,
              message: "Browser application modules must not depend on controllers, composition, adapters, public env, or UI."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/browser/*/browser*Controller.{ts,tsx}"],
    ignores: ["src/browser/**/*.test.{ts,tsx}"],
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
          patterns: [
            {
              regex: "^(?:\\.\\./)+core/auth/parsePubkyAuthRequest$",
              importNames: ["ValidatedSensitivePubkyAuthRequest"],
              message: "Public browser contracts must expose safe review state, not sensitive parser approval types."
            },
            {
              regex: `(?:^|/)(?:adapters|composition|env)(?:/|$)|(?:^|/)(?:${browserControllerImplementation}|${browserControllerFactory})$|(?:^|/)ui(?:/|$)`,
              message: "Public browser controller contracts must not depend on concrete controllers, composition, adapters, public env, or UI."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/browser/*/passport*Controller.{ts,tsx}"],
    ignores: ["src/browser/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: `(?:^|/)(?:adapters|composition|env)(?:/|$)|(?:^|/)${browserControllerFactory}$|(?:^|/)ui(?:/|$)`,
              message: "Browser controllers may depend on public and application contracts, not composition, adapters, public env, or UI."
            }
          ]
        }
      ]
    }
  },
  {
    files: [
      "src/browser/**/composition/**/*.{ts,tsx}",
      "src/browser/*/createBrowser*Controller.{ts,tsx}"
    ],
    ignores: ["src/browser/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^server-only$|(?:^|/)(?:ui|server)(?:/|$)",
              message: "Browser composition roots may wire browser features but must not depend on UI or server runtime code."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/browser/**/adapters/**/*.{ts,tsx}"],
    ignores: ["src/browser/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: `^server-only$|(?:^|/)(?:adapters|ui|server|composition|env)(?:/|$)|(?:^|/)${anyBrowserController}$`,
              message: "Browser adapters may depend on application contracts, not controllers, UI, composition roots, or runtime configuration."
            }
          ]
        }
      ]
    }
  },
]);

export default eslintConfig;
