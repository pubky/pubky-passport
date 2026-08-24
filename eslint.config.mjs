import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const ESLINT_CONFIG = defineConfig([
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
    files: ["**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: ["src/libs/logger/logger.ts"],
    rules: {
      "no-console": "error"
    }
  },
  {
    files: ["src/client/logic/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: ["src/client/logic/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            regex: "^(?:server-only$|@/server(?:/|$)|(?:\\.\\./)+server(?:/|$))",
            message: "Client logic modules must not import server runtime code."
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
            regex: "^(?:client-only$|@/(?:client/logic|libs/env)(?:/|$)|(?:\\.\\./)+(?:client/logic|libs/env)(?:/|$))",
            message: "Server modules must not import client logic or public environment code."
          }]
        }
      ]
    }
  },
  {
    files: ["src/server/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: [
      "src/server/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
      "src/server/wrapping-key/google/GoogleWrappingKeyIssuer.ts"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            regex: "^(?:@/server/config(?:/|$)|(?:\\.\\./)+config(?:/|$))",
            message: "Environment-backed configuration is confined to approved bootstrap modules."
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
            message: "Environment-backed client bootstrap configuration is confined to approved app entries."
          }]
        }
      ]
    }
  },
]);

export default ESLINT_CONFIG;
