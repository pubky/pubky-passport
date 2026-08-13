import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
      join(REPO_ROOT, "src", "client", "ui", "authorizationReview.tsx"),
      "@/client/browser/authorization/passportAuthorization",
    )).toBe(join(REPO_ROOT, "src", "client", "browser", "authorization", "passportAuthorization.ts"));
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

  it("detects local production import cycles", () => {
    const cycleA = join(FIXTURE_ROOT, "cycle-a.ts");
    const cycleB = join(FIXTURE_ROOT, "cycle-b.ts");

    expect(GRAPH.localImportCycles(FIXTURE_ROOT)).toContainEqual([cycleA, cycleB, cycleA]);
  });
});
