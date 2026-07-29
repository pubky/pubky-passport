import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  APP_SERVER_ENTRY_RULE,
  browserModuleRole,
  BROWSER_ROLE_RULES,
  restrictedImportRegexForRoleRule,
  restrictedServerImportRegexForAppRule,
  serverModuleRole,
  SERVER_ROLE_RULES,
} from "./architecturePolicy.mjs";
import {
  importSpecifiersFromSource,
  ModuleGraph,
  nonLiteralModuleLoadsFromSource,
} from "./moduleGraph";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_ROOT = join(REPO_ROOT, "test-utils", "architecture", "fixtures");
const GRAPH = new ModuleGraph(REPO_ROOT);

describe("ModuleGraph", () => {
  it("discovers static imports, re-exports, import-equals, and literal dynamic imports", () => {
    const source = `
      import value from "static-package";
      export { value as shared } from "./shared.js";
      import legacy = require("legacy-package");
      const loaded = import("./dynamic.js");
      const templated = import(\`./literal-template.js\`);
      const attributed = import("./attributed.json", { with: { type: "json" } });
      const required = require("./commonjs.cjs");
      const ignored = import(variableName);
      const text = 'import "not-an-import"';
    `;

    expect(importSpecifiersFromSource(source)).toEqual([
      "static-package",
      "./shared.js",
      "legacy-package",
      "./dynamic.js",
      "./literal-template.js",
      "./attributed.json",
      "./commonjs.cjs",
    ]);
    expect(nonLiteralModuleLoadsFromSource(source)).toEqual(["import at fixture.ts:9"]);
  });

  it("resolves aliases, JavaScript specifiers, index re-exports, and mts modules", () => {
    expect(GRAPH.resolveLocalImportTarget(
      join(REPO_ROOT, "src", "ui", "authorizationReview.tsx"),
      "@/browser/authorization/browserAuthorizationController",
    )).toBe(join(REPO_ROOT, "src", "browser", "authorization", "browserAuthorizationController.ts"));
    expect(GRAPH.resolveLocalImportTarget(
      join(FIXTURE_ROOT, "transitive-entry.ts"),
      "./shared/index.js",
    )).toBe(join(FIXTURE_ROOT, "shared", "index.ts"));
    expect(GRAPH.sourceFiles(FIXTURE_ROOT)).toContain(join(FIXTURE_ROOT, "dynamic-entry.mts"));
    expect(GRAPH.sourceFiles(FIXTURE_ROOT)).toContain(join(FIXTURE_ROOT, "jsx-entry.jsx"));
    expect(GRAPH.resolveLocalImportTarget(
      join(FIXTURE_ROOT, "dynamic-entry.mts"),
      "./server-target.js",
    )).toBe(join(FIXTURE_ROOT, "server-target.ts"));
  });

  it("resolves CommonJS require calls for transitive boundary checks", () => {
    const violations = GRAPH.inspectForbiddenImports(join(FIXTURE_ROOT, "require-entry.cjs"), {
      forbiddenTargets: [{
        targetPath: join(FIXTURE_ROOT, "server-target.ts"),
        label: "fixture server target",
      }],
      traverseLocalImports: true,
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("fixture server target");
  });

  it("reports forbidden targets through transitive re-exports", () => {
    const violations = GRAPH.inspectForbiddenImports(join(FIXTURE_ROOT, "transitive-entry.ts"), {
      forbiddenTargets: [{
        targetPath: join(FIXTURE_ROOT, "server-target.ts"),
        label: "fixture server target",
      }],
      traverseLocalImports: true,
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("fixture server target");
  });

  it("requires a runtime marker to be the opening import", () => {
    expect(GRAPH.hasOpeningImport(join(FIXTURE_ROOT, "marker-first.mts"), "client-only")).toBe(true);
    expect(GRAPH.hasOpeningImport(join(FIXTURE_ROOT, "marker-late.ts"), "client-only")).toBe(false);
  });

  it("detects computed access to persistence globals", () => {
    const fixture = join(FIXTURE_ROOT, "computed-persistence.ts");
    expect(GRAPH.referencesElementProperty(fixture, ["globalThis", "window"], "localStorage")).toBe(true);
    expect(GRAPH.referencesElementProperty(fixture, ["globalThis", "window"], "sessionStorage")).toBe(true);
    expect(GRAPH.referencesElementProperty(fixture, ["document"], "cookie")).toBe(true);
  });
});

describe("architecture policy", () => {
  it.each([
    ["identity/application/useCase.ts", "application"],
    ["identity/adapters/provider.ts", "adapter"],
    ["identity/composition/runtime.ts", "composition"],
    ["identity/browserIdentityController.ts", "public"],
    ["identity/browserIdentityController.jsx", "public"],
    ["identity/createBrowserIdentityController.ts", "composition"],
    ["identity/passportIdentityController.ts", "controller"],
    ["identity/application/adapters/mixed.ts", "unclassified"],
    ["identity/unowned.ts", "unclassified"],
  ])("classifies %s as %s", (relativePath, role) => {
    expect(browserModuleRole(relativePath)).toBe(role);
  });

  it.each([
    ["wrapping-key/google/application/useCase.ts", "application"],
    ["wrapping-key/google/adapters/provider.ts", "adapter"],
    ["wrapping-key/google/composition/runtime.ts", "composition"],
    ["wrapping-key/google/application/adapters/mixed.ts", "unclassified"],
    ["config/runtime.ts", "unclassified"],
  ])("classifies server module %s as %s", (relativePath, role) => {
    expect(serverModuleRole(relativePath)).toBe(role);
  });

  it("gives every role rule a unique stable ID", () => {
    const ids = [
      ...BROWSER_ROLE_RULES.map((rule) => rule.id),
      ...SERVER_ROLE_RULES.map((rule) => rule.id),
      APP_SERVER_ENTRY_RULE.id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pins the server role dependency matrix", () => {
    expect(SERVER_ROLE_RULES.map((rule) => ({
      id: rule.id,
      forbiddenRoles: rule.forbiddenRoles,
      forbiddenRoots: rule.forbiddenRoots,
      forbiddenSpecifiers: rule.forbiddenSpecifiers,
    }))).toEqual([
      {
        id: "server-application-inward",
        forbiddenRoles: ["adapter", "composition"],
        forbiddenRoots: ["src/app", "src/ui", "src/browser", "src/server/config"],
        forbiddenSpecifiers: [],
      },
      {
        id: "server-adapter-inward",
        forbiddenRoles: ["composition"],
        forbiddenRoots: ["src/app", "src/ui", "src/browser", "src/server/config"],
        forbiddenSpecifiers: ["client-only"],
      },
      {
        id: "server-composition-runtime",
        forbiddenRoles: [],
        forbiddenRoots: ["src/app", "src/ui", "src/browser"],
        forbiddenSpecifiers: ["client-only"],
      },
    ]);
  });

  it("pins the security-relevant browser role dependency matrix", () => {
    expect(BROWSER_ROLE_RULES.map((rule) => ({
      id: rule.id,
      forbiddenRoles: rule.forbiddenRoles,
      forbiddenRoots: rule.forbiddenRoots,
      forbiddenSpecifiers: rule.forbiddenSpecifiers,
    }))).toEqual([
      {
        id: "browser-application-inward",
        forbiddenRoles: ["composition", "controller", "public"],
        forbiddenRoots: ["src/libs/env", "src/ui"],
        forbiddenSpecifiers: [],
      },
      {
        id: "browser-public-contract-inward",
        forbiddenRoles: ["adapter", "composition", "controller"],
        forbiddenRoots: ["src/libs/env", "src/ui"],
        forbiddenSpecifiers: [],
      },
      {
        id: "browser-controller-inward",
        forbiddenRoles: ["adapter", "composition"],
        forbiddenRoots: ["src/libs/env", "src/ui"],
        forbiddenSpecifiers: [],
      },
      {
        id: "browser-adapter-inward",
        forbiddenRoles: ["adapter", "composition", "controller", "public"],
        forbiddenRoots: ["src/libs/env", "src/ui", "src/server"],
        forbiddenSpecifiers: ["server-only"],
      },
      {
        id: "browser-composition-runtime",
        forbiddenRoles: [],
        forbiddenRoots: ["src/ui", "src/server"],
        forbiddenSpecifiers: ["server-only"],
      },
    ]);
  });

  it.each([
    ["browser-application-inward", "../composition/runtime"],
    ["browser-public-contract-inward", "../composition/runtime"],
    ["browser-controller-inward", "../adapters/provider"],
    ["browser-adapter-inward", "server-only"],
    ["browser-composition-runtime", "@/server/config"],
  ])("generates direct-import enforcement for %s", (ruleId, forbiddenImport) => {
    const rule = BROWSER_ROLE_RULES.find((candidate) => candidate.id === ruleId);
    expect(rule).toBeDefined();
    expect(new RegExp(restrictedImportRegexForRoleRule(rule), "u").test(forbiddenImport)).toBe(true);
  });

  it("allows browser application modules to import adapters", () => {
    const rule = BROWSER_ROLE_RULES.find((candidate) => candidate.id === "browser-application-inward");
    expect(rule).toBeDefined();
    const restricted = new RegExp(restrictedImportRegexForRoleRule(rule), "u");

    expect(restricted.test("../../../homegate/adapters/homegateClient")).toBe(false);
  });

  it("matches forbidden roots exactly instead of matching unrelated config segments", () => {
    const rule = SERVER_ROLE_RULES.find((candidate) => candidate.id === "server-application-inward");
    expect(rule).toBeDefined();
    const restricted = new RegExp(restrictedImportRegexForRoleRule(rule), "u");

    expect(restricted.test("@/server/config/runtime")).toBe(true);
    expect(restricted.test("../../../src/server/config/runtime")).toBe(true);
    expect(restricted.test("@vendor/config")).toBe(false);
    expect(restricted.test("../config/runtime")).toBe(false);
  });

  it("restricts direct app imports of server adapters only", () => {
    const restricted = new RegExp(restrictedServerImportRegexForAppRule(APP_SERVER_ENTRY_RULE), "u");

    expect(restricted.test("@/server/wrapping-key/google/adapters/googleIdTokenVerifier")).toBe(true);
    expect(restricted.test("../../../../server/wrapping-key/google/adapters/googleIdTokenVerifier")).toBe(true);
    expect(restricted.test("@/server/wrapping-key/google/application/requestGoogleWrappingKey")).toBe(false);
    expect(restricted.test("../../../../server/wrapping-key/google/composition/createConfiguredGoogleWrappingKeyRequest")).toBe(false);
    expect(restricted.test("@vendor/server/adapters")).toBe(false);
  });

  it.each([
    ["server-application-inward", "../adapters/provider"],
    ["server-adapter-inward", "../composition/runtime"],
    ["server-composition-runtime", "@/browser/identity"],
  ])("generates server direct-import enforcement for %s", (ruleId, forbiddenImport) => {
    const rule = SERVER_ROLE_RULES.find((candidate) => candidate.id === ruleId);
    expect(rule).toBeDefined();
    expect(new RegExp(restrictedImportRegexForRoleRule(rule), "u").test(forbiddenImport)).toBe(true);
  });
});
