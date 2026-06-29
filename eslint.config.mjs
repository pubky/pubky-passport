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
                "@/app/*",
                "@/ui/*",
                "@/infrastructure/*",
                "@/libs/env/*"
              ],
              message: "Core must stay framework-independent. Use ports and adapters instead."
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
  {
    files: ["src/core/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/core/application/*",
                "@/core/controllers/*",
                "@/core/stores/*",
                "@/infrastructure/*",
                "@/app/*",
                "@/ui/*"
              ],
              message: "Domain must not depend on outer layers."
            }
          ]
        }
      ]
    }
  }
]);

export default eslintConfig;
