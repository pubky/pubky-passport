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
    "playwright-report/**",
    "test-results/**",
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
                "@/app/*",
                "@/ui/*",
                "@/adapters/*",
                "@/composition/*",
                "@/libs/env/*"
              ],
              message: "Core must stay framework- and runtime-independent. Use feature-local dependency contracts and adapters instead."
            }
          ]
        }
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "window",
          message: "Core must not access browser globals. Use a port instead."
        },
        {
          name: "document",
          message: "Core must not access browser globals. Use a port instead."
        },
        {
          name: "localStorage",
          message: "Core must not access browser storage directly. Use a port instead."
        },
        {
          name: "process",
          message: "Core must not read runtime environment directly. Pass configuration through ports or inputs."
        }
      ]
    }
  },
]);

export default eslintConfig;
