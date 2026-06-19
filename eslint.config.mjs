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
                "@/app/*",
                "@/ui/*",
                "@/infrastructure/*"
              ],
              message: "Core must stay framework-independent. Use ports and adapters instead."
            }
          ]
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
