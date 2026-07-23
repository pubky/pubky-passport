import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    files: ["src/features/**/*.{ts,tsx}"],
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
                "@/app/*",
                "@/ui/*",
                "@/browser/*",
                "@/server/*",
                "@/libs/env/*"
              ],
              message: "Features must stay framework- and runtime-independent. Use browser or server runtime code instead."
            }
          ]
        }
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "window",
          message: "Features must not access browser globals. Use a dependency contract instead."
        },
        {
          name: "document",
          message: "Features must not access browser globals. Use a dependency contract instead."
        },
        {
          name: "localStorage",
          message: "Features must not access browser storage directly. Use a dependency contract instead."
        },
        {
          name: "process",
          message: "Features must not read runtime environment directly. Pass configuration through contracts or inputs."
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
              name: "../features/auth/parsePubkyAuthRequest",
              importNames: ["ValidatedSensitivePubkyAuthRequest"],
              message: "UI must consume safe authorization controller state, not sensitive parser approval types."
            },
            {
              name: "@/features/auth/parsePubkyAuthRequest",
              importNames: ["ValidatedSensitivePubkyAuthRequest"],
              message: "UI must consume safe authorization controller state, not sensitive parser approval types."
            }
          ],
          patterns: [
            {
              regex: "^(?:\\.\\./)+browser/(?!(?:authorization/(?:browserAuthorizationController|createBrowserAuthorizationController)|identity/(?:browserIdentityController|createBrowserIdentityController))$)",
              message: "UI may import browser runtime only through stable controller APIs and their concrete factories."
            },
            {
              regex: "^@/browser/(?!(?:authorization/(?:browserAuthorizationController|createBrowserAuthorizationController)|identity/(?:browserIdentityController|createBrowserIdentityController))$)",
              message: "UI may import browser runtime only through stable controller APIs and their concrete factories."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/browser/**/*.{ts,tsx}"],
    ignores: [
      "src/browser/**/*.test.{ts,tsx}",
      "src/browser/authorization/createBrowserAuthorizationController.ts",
      "src/browser/identity/createBrowserIdentityController.ts",
      "src/browser/identity/adapters/**/*.{ts,tsx}",
      "src/browser/passport-file/googleDrivePassportFileRepository.ts",
      "src/browser/passport-file/webCryptoPassportFileCrypto.ts",
      "src/browser/pubky/browserPubky.ts"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(?:^|/)adapters(?:/|$)|(?:^|/)(?:createBrowserAuthorizationController|createBrowserIdentityController|browserPubky|googleDrivePassportFileRepository|webCryptoPassportFileCrypto|public-env)$|(?:^|/)ui(?:/|$)",
              message: "Browser application modules must depend on contracts, not composition, adapters, public env, or UI."
            }
          ]
        }
      ]
    }
  },
  {
    files: [
      "src/browser/identity/adapters/**/*.{ts,tsx}",
      "src/browser/passport-file/googleDrivePassportFileRepository.ts",
      "src/browser/passport-file/webCryptoPassportFileCrypto.ts",
      "src/browser/pubky/browserPubky.ts"
    ],
    ignores: ["src/browser/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^server-only$|(?:^|/)(?:ui|server|composition|env)(?:/|$)|(?:^|/)(?:createBrowserAuthorizationController|createBrowserIdentityController)$",
              message: "Browser adapters may depend inward on application policy and contracts, not UI, composition roots, or runtime configuration."
            }
          ]
        }
      ]
    }
  },
]);

export default eslintConfig;
