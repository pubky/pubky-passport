import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  appServerEntryRule,
  browserModuleRole,
  browserRoleRules,
  restrictedImportRegexForRoleRule,
  restrictedServerImportRegexForAppRule,
  serverModuleRole,
  serverRoleRules,
} from "./architecturePolicy.mjs";
import {
  importSpecifiersFromSource,
  ModuleGraph,
  nonLiteralModuleLoadsFromSource,
} from "./moduleGraph";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = join(repoRoot, "test-utils", "architecture", "fixtures");
const graph = new ModuleGraph(repoRoot);

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
    expect(graph.resolveLocalImportTarget(
      join(repoRoot, "src", "ui", "authorizationReview.tsx"),
      "@/browser/authorization/browserAuthorizationController",
    )).toBe(join(repoRoot, "src", "browser", "authorization", "browserAuthorizationController.ts"));
    expect(graph.resolveLocalImportTarget(
      join(fixtureRoot, "transitive-entry.ts"),
      "./shared/index.js",
    )).toBe(join(fixtureRoot, "shared", "index.ts"));
    expect(graph.sourceFiles(fixtureRoot)).toContain(join(fixtureRoot, "dynamic-entry.mts"));
    expect(graph.sourceFiles(fixtureRoot)).toContain(join(fixtureRoot, "jsx-entry.jsx"));
    expect(graph.resolveLocalImportTarget(
      join(fixtureRoot, "dynamic-entry.mts"),
      "./server-target.js",
    )).toBe(join(fixtureRoot, "server-target.ts"));
  });

  it("resolves CommonJS require calls for transitive boundary checks", () => {
    const violations = graph.inspectForbiddenImports(join(fixtureRoot, "require-entry.cjs"), {
      forbiddenTargets: [{
        targetPath: join(fixtureRoot, "server-target.ts"),
        label: "fixture server target",
      }],
      traverseLocalImports: true,
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("fixture server target");
  });

  it("reports forbidden targets through transitive re-exports", () => {
    const violations = graph.inspectForbiddenImports(join(fixtureRoot, "transitive-entry.ts"), {
      forbiddenTargets: [{
        targetPath: join(fixtureRoot, "server-target.ts"),
        label: "fixture server target",
      }],
      traverseLocalImports: true,
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("fixture server target");
  });

  it("requires a runtime marker to be the opening import", () => {
    expect(graph.hasOpeningImport(join(fixtureRoot, "marker-first.mts"), "client-only")).toBe(true);
    expect(graph.hasOpeningImport(join(fixtureRoot, "marker-late.ts"), "client-only")).toBe(false);
  });

  it("detects computed access to persistence globals", () => {
    const fixture = join(fixtureRoot, "computed-persistence.ts");
    expect(graph.referencesElementProperty(fixture, ["globalThis", "window"], "localStorage")).toBe(true);
    expect(graph.referencesElementProperty(fixture, ["globalThis", "window"], "sessionStorage")).toBe(true);
    expect(graph.referencesElementProperty(fixture, ["document"], "cookie")).toBe(true);
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
      ...browserRoleRules.map((rule) => rule.id),
      ...serverRoleRules.map((rule) => rule.id),
      appServerEntryRule.id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pins the server role dependency matrix", () => {
    expect(serverRoleRules.map((rule) => ({
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
    expect(browserRoleRules.map((rule) => ({
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
    const rule = browserRoleRules.find((candidate) => candidate.id === ruleId);
    expect(rule).toBeDefined();
    expect(new RegExp(restrictedImportRegexForRoleRule(rule), "u").test(forbiddenImport)).toBe(true);
  });

  it("allows browser application modules to import adapters", () => {
    const rule = browserRoleRules.find((candidate) => candidate.id === "browser-application-inward");
    expect(rule).toBeDefined();
    const restricted = new RegExp(restrictedImportRegexForRoleRule(rule), "u");

    expect(restricted.test("../../../homegate/adapters/homegateClient")).toBe(false);
  });

  it("matches forbidden roots exactly instead of matching unrelated config segments", () => {
    const rule = serverRoleRules.find((candidate) => candidate.id === "server-application-inward");
    expect(rule).toBeDefined();
    const restricted = new RegExp(restrictedImportRegexForRoleRule(rule), "u");

    expect(restricted.test("@/server/config/runtime")).toBe(true);
    expect(restricted.test("../../../src/server/config/runtime")).toBe(true);
    expect(restricted.test("@vendor/config")).toBe(false);
    expect(restricted.test("../config/runtime")).toBe(false);
  });

  it("restricts direct app imports of server adapters only", () => {
    const restricted = new RegExp(restrictedServerImportRegexForAppRule(appServerEntryRule), "u");

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
    const rule = serverRoleRules.find((candidate) => candidate.id === ruleId);
    expect(rule).toBeDefined();
    expect(new RegExp(restrictedImportRegexForRoleRule(rule), "u").test(forbiddenImport)).toBe(true);
  });
});
