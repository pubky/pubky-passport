import { ESLint, Linter } from "eslint";
import { expect, test } from "vitest";

const eslint = new ESLint();
async function boundaryMessages(path: string, code: string) {
  const config = await eslint.calculateConfigForFile(path);
  return new Linter().verify(code, {
    languageOptions: { parser: config.languageOptions.parser },
    plugins: config.plugins,
    rules: {
      "no-restricted-imports": config.rules["no-restricted-imports"],
      "no-restricted-syntax": config.rules["no-restricted-syntax"],
      "@typescript-eslint/no-import-type-side-effects":
        config.rules["@typescript-eslint/no-import-type-side-effects"] ?? "off",
    },
  });
}

test.each([
  ["config/options.ts", "@/app/page"],
  ["config/options.ts", "@synonymdev/pubky"],
  ["config/options.ts", "react"],
  ["config/options.ts", "node:fs"],
  ["config/options.ts", "../ui/view.js"],
  ["config/options.ts", "../qrcode/renderQrSvg.js"],
  ["config/options.ts", "../index.js"],
  ["flow/pubkyFlowAdapter.ts", "../ui/view.js"],
  ["flow/pubkyFlowAdapter.ts", "pubky-app-specs"],
  ["profile/readProfile.ts", "pubky-app-specs"],
  ["profile/validateProfile.ts", "@synonymdev/pubky"],
  ["profile/validateProfile.ts", "../ui/view.js"],
  ["ui/view.ts", "react"],
  ["element.ts", "./qrcode/vendor/qrcodegen.js"],
])("enforces static and dynamic package boundaries in %s for %s", async (path, dependency) => {
  for (const code of [`import "${dependency}";`, `import("${dependency}");`]) {
    const messages = await boundaryMessages(`packages/passport-client/src/${path}`, code);
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(message.ruleId).toMatch(/^no-restricted-/u);
  }
});

test.each(["import(`../ui/view.js`);", "import(name);"])(
  "rejects computed imports: %s",
  async (code) => {
    const messages = await boundaryMessages("packages/passport-client/src/config/options.ts", code);
    expect(messages.some(({ ruleId }) => ruleId === "no-restricted-syntax")).toBe(true);
  },
);

test("rejects inline type imports that emit a peer side effect", async () => {
  const messages = await boundaryMessages(
    "packages/passport-client/src/config/options.ts",
    'import { type Pubky } from "@synonymdev/pubky";',
  );
  expect(
    messages.some(({ ruleId }) => ruleId === "@typescript-eslint/no-import-type-side-effects"),
  ).toBe(true);
});

test.each([
  ["flow/pubkyFlowAdapter.ts", 'import { Pubky } from "@synonymdev/pubky";'],
  ["flow/pubkyFlowAdapter.ts", 'import("@synonymdev/pubky");'],
  ["config/options.ts", 'import type { Pubky } from "@synonymdev/pubky";'],
  ["profile/validateProfile.ts", 'import("pubky-app-specs");'],
  ["profile/validateProfile.ts", 'import type { PubkyAppUser } from "pubky-app-specs";'],
  ["qrcode/renderQrSvg.ts", 'import "./vendor/qrcodegen.js";'],
])("allows the adapter or type-only boundary in %s", async (path, code) => {
  expect(await boundaryMessages(`packages/passport-client/src/${path}`, code)).toEqual([]);
});
