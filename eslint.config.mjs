import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts"
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
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
];

export default eslintConfig;
