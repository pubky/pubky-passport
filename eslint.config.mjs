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
]);

export default eslintConfig;
