import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  browserModuleRole,
  browserRoleRules,
  restrictedImportRegexForRoleRule,
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

  it("gives every role rule a unique stable ID", () => {
    const ids = browserRoleRules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
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
        forbiddenRoles: ["adapter", "composition", "controller", "public"],
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
    ["browser-application-inward", "../adapters/provider"],
    ["browser-public-contract-inward", "../composition/runtime"],
    ["browser-controller-inward", "../adapters/provider"],
    ["browser-adapter-inward", "server-only"],
    ["browser-composition-runtime", "@/server/config"],
  ])("generates direct-import enforcement for %s", (ruleId, forbiddenImport) => {
    const rule = browserRoleRules.find((candidate) => candidate.id === ruleId);
    expect(rule).toBeDefined();
    expect(new RegExp(restrictedImportRegexForRoleRule(rule), "u").test(forbiddenImport)).toBe(true);
  });
});
