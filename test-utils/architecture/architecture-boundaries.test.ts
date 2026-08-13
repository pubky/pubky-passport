import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STABLE_BROWSER_UI_ENTRIES } from "./architectureEntries.mjs";
import { isSameOrInside, ModuleGraph, type ForbiddenTarget } from "./moduleGraph";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_ROOT = join(REPO_ROOT, "src");
const CLIENT_ROOT = join(SRC_ROOT, "client");
const BROWSER_ROOT = join(CLIENT_ROOT, "browser");
const SERVER_ROOT = join(SRC_ROOT, "server");
const APP_ROOT = join(SRC_ROOT, "app");
const UI_ROOT = join(CLIENT_ROOT, "ui");
const LIBS_ROOT = join(SRC_ROOT, "libs");
const PUBLIC_ENV_ROOT = join(LIBS_ROOT, "env");
const SERVER_CONFIG_ROOT = join(SERVER_ROOT, "config");
const IDENTITY_ROOT = join(BROWSER_ROOT, "identity");
const LOCAL_IDENTITY_REPOSITORY = join(IDENTITY_ROOT, "local", "localStorageIdentityRepository.ts");
const PUBKY_SDK_ADAPTER = join(BROWSER_ROOT, "pubky", "pubkySdkAdapter.ts");
const PUBKY_SDK_ADAPTER_TEST = join(BROWSER_ROOT, "pubky", "pubkySdkAdapter.test.ts");
const PUBKY_SDK_ADAPTER_STAGING_TEST = join(BROWSER_ROOT, "pubky", "pubkySdkAdapter.staging.test.ts");
const GOOGLE_WRAPPING_KEY_REQUEST = join(
  SERVER_ROOT,
  "wrapping-key",
  "google",
  "googleWrappingKeyRequest.ts",
);
const GOOGLE_CLIENT_ID_CONFIG = join(SERVER_CONFIG_ROOT, "googleClientId.ts");
const BROWSER_BOOTSTRAP_CONFIG = join(SERVER_CONFIG_ROOT, "browserBootstrapConfig.ts");
const GOOGLE_WRAPPING_KEY_ROUTE = join(APP_ROOT, "api", "wrapping-key", "google", "route.ts");
const APP_HOME_PAGE = join(APP_ROOT, "page.tsx");
const APP_AUTHORIZE_PAGE = join(APP_ROOT, "authorize", "page.tsx");
const PROXY = join(SRC_ROOT, "proxy.ts");
const STABLE_UI_BROWSER_MODULES = new Set(
  STABLE_BROWSER_UI_ENTRIES.map((entry) => join(BROWSER_ROOT, `${entry}.ts`)),
);
const UI_CROSS_SLICE_COMPOSERS = new Set([
  join(UI_ROOT, "authorization", "authorizationFlow.tsx"),
  join(UI_ROOT, "identity-catalog", "selection", "identitySelectionFlow.tsx"),
  join(UI_ROOT, "identity-dashboard", "identityDashboard.tsx"),
  join(UI_ROOT, "identity-dashboard", "management", "detach-from-google", "detachFromGoogleFlow.tsx"),
  join(UI_ROOT, "onboarding", "signInFlow.tsx"),
]);
const GRAPH = new ModuleGraph(REPO_ROOT);

describe("architecture boundaries", () => {
  it("confines concrete Pubky SDK imports to the browser Pubky adapter", () => {
    const violations = GRAPH.sourceFiles(SRC_ROOT)
      .filter((filePath) => GRAPH.importSpecifiers(filePath).some((specifier) =>
        specifier === "@synonymdev/pubky" || specifier.startsWith("@synonymdev/pubky/")
      ))
      .filter((filePath) =>
        filePath !== PUBKY_SDK_ADAPTER
        && filePath !== PUBKY_SDK_ADAPTER_TEST
        && filePath !== PUBKY_SDK_ADAPTER_STAGING_TEST
      )
      .map((filePath) => `${relative(REPO_ROOT, filePath)} imports @synonymdev/pubky outside the browser Pubky adapter`);

    expect(violations).toEqual([]);
  });

  it("keeps browser and server runtime code isolated", () => {
    const violations = [
      ...runtimeIsolationViolations(BROWSER_ROOT, [
        { targetPath: SERVER_ROOT, label: "server runtime" },
      ], ["server-only"]),
      ...runtimeIsolationViolations(SERVER_ROOT, [
        { targetPath: BROWSER_ROOT, label: "browser runtime" },
        { targetPath: PUBLIC_ENV_ROOT, label: "public environment configuration" },
      ], ["client-only"]),
    ];

    expect(violations).toEqual([]);
  });

  it("starts every runtime module with its runtime marker", () => {
    const violations = [
      ...missingOpeningRuntimeMarkers(BROWSER_ROOT, "client-only"),
      ...missingOpeningRuntimeMarkers(SERVER_ROOT, "server-only"),
    ];

    expect(violations).toEqual([]);
  });

  it("requires production module loads to use statically analyzable specifiers", () => {
    const violations = GRAPH.productionSourceFiles(SRC_ROOT).flatMap((filePath) =>
      GRAPH.nonLiteralModuleLoads(filePath).map((load) =>
        `${relative(REPO_ROOT, filePath)} contains non-literal ${load}`
      )
    );

    expect(violations).toEqual([]);
  });

  it("keeps the production module graph free of import cycles", () => {
    const cycles = GRAPH.localImportCycles(SRC_ROOT).map((cycle) =>
      cycle.map((filePath) => relative(REPO_ROOT, filePath)).join(" -> ")
    );

    expect(cycles).toEqual([]);
  });

  it("limits browser persistence to the local identity repository", () => {
    const browserCapableFiles = [
      ...GRAPH.productionSourceFiles(BROWSER_ROOT),
      ...GRAPH.productionSourceFiles(UI_ROOT),
      ...GRAPH.productionSourceFiles(APP_ROOT).filter(isClientModule),
    ];
    const violations = browserCapableFiles.flatMap((filePath) => [
      ...(filePath === LOCAL_IDENTITY_REPOSITORY || !GRAPH.referencesIdentifier(filePath, "localStorage")
        ? []
        : [`${relative(REPO_ROOT, filePath)} references forbidden browser persistence "localStorage"`]),
      ...["sessionStorage", "indexedDB"]
        .filter((identifier) => GRAPH.referencesIdentifier(filePath, identifier))
        .map((identifier) => `${relative(REPO_ROOT, filePath)} references forbidden browser persistence "${identifier}"`),
      ...(GRAPH.referencesProperty(filePath, "document", "cookie")
        ? [`${relative(REPO_ROOT, filePath)} references forbidden browser persistence "document.cookie"`]
        : []),
      ...["localStorage", "sessionStorage", "indexedDB"]
        .filter((property) => GRAPH.referencesElementProperty(filePath, ["globalThis", "window"], property))
        .map((property) => `${relative(REPO_ROOT, filePath)} references forbidden computed browser persistence "${property}"`),
      ...(GRAPH.referencesElementProperty(filePath, ["document"], "cookie")
        ? [`${relative(REPO_ROOT, filePath)} references forbidden computed browser persistence "document.cookie"`]
        : []),
    ]);

    expect(violations).toEqual([]);
  });

  it("requires UI and app modules to opt into client rendering before importing browser runtime", () => {
    const violations = [
      ...GRAPH.productionSourceFiles(UI_ROOT),
      ...GRAPH.productionSourceFiles(APP_ROOT),
    ]
      .filter((filePath) => GRAPH.importsTarget(filePath, BROWSER_ROOT))
      .filter((filePath) => !isClientModule(filePath))
      .map((filePath) => `${relative(REPO_ROOT, filePath)} imports browser runtime without "use client"`);

    expect(violations).toEqual([]);
  });

  it("keeps server-only dependencies out of UI and client app modules", () => {
    const forbiddenTargets = [{ targetPath: SERVER_ROOT, label: "server runtime" }];
    const violations = [
      ...GRAPH.productionSourceFiles(UI_ROOT),
      ...GRAPH.productionSourceFiles(APP_ROOT).filter(isClientModule),
    ].flatMap((filePath) => GRAPH.inspectForbiddenImports(filePath, {
      forbiddenModuleSpecifiers: ["server-only"],
      forbiddenTargets,
    }));

    expect(violations).toEqual([]);
  });

  it("limits production UI browser imports to stable controller APIs and factories", () => {
    expect(GRAPH.productionSourceFiles(UI_ROOT).flatMap(inspectUiBrowserImports)).toEqual([]);
  });

  it("confines cross-slice UI imports to explicit flow composers", () => {
    const violations = GRAPH.productionSourceFiles(UI_ROOT).flatMap((filePath) => {
      const sourceSlice = dirname(relative(UI_ROOT, filePath));
      return GRAPH.importSpecifiers(filePath).flatMap((specifier) => {
        const target = GRAPH.resolveLocalImportTarget(filePath, specifier);
        if (!target || !isSameOrInside(target, UI_ROOT)) return [];
        const targetFeature = relative(UI_ROOT, target).split(/[\\/]/u)[0];
        const targetSlice = dirname(relative(UI_ROOT, target));
        if (sourceSlice === targetSlice || targetFeature === "shared") return [];
        return UI_CROSS_SLICE_COMPOSERS.has(filePath)
          ? []
          : [`${relative(REPO_ROOT, filePath)} imports UI slice ${targetSlice} without being a flow composer`];
      });
    });

    expect(violations).toEqual([]);
  });

  it("keeps server environment access in approved bootstrap modules", () => {
    const violations = GRAPH.productionSourceFiles(SERVER_ROOT)
      .filter((filePath) => GRAPH.referencesProperty(filePath, "process", "env"))
      .filter((filePath) => !isSameOrInside(filePath, SERVER_CONFIG_ROOT))
      .filter((filePath) => filePath !== GOOGLE_WRAPPING_KEY_REQUEST)
      .map((filePath) => `${relative(REPO_ROOT, filePath)} accesses process.env outside an approved bootstrap module`);

    expect(violations).toEqual([]);
  });

  it("confines environment-backed configuration imports", () => {
    const productionModules = [...GRAPH.productionSourceFiles(SRC_ROOT), PROXY];
    const approvedConsumers = new Map<string, Set<string>>([
      [GOOGLE_CLIENT_ID_CONFIG, new Set([
        BROWSER_BOOTSTRAP_CONFIG,
        GOOGLE_WRAPPING_KEY_REQUEST,
      ])],
      [BROWSER_BOOTSTRAP_CONFIG, new Set([APP_HOME_PAGE, APP_AUTHORIZE_PAGE, PROXY])],
    ]);
    const violations = [...approvedConsumers].flatMap(([target, approved]) =>
      productionModules
        .filter((filePath) => GRAPH.importsTarget(filePath, target) && !approved.has(filePath))
        .map((filePath) => `${relative(REPO_ROOT, filePath)} imports protected module ${relative(REPO_ROOT, target)}`)
    );

    violations.push(...productionModules
      .filter((filePath) => filePath !== GOOGLE_WRAPPING_KEY_REQUEST)
      .filter((filePath) => GRAPH.referencesIdentifier(filePath, "createConfiguredGoogleWrappingKeyRequest"))
      .filter((filePath) => filePath !== GOOGLE_WRAPPING_KEY_ROUTE)
      .map((filePath) => `${relative(REPO_ROOT, filePath)} references the protected wrapping-key bootstrap`));

    expect(violations).toEqual([]);
  });

  it("keeps sensitive approval types out of public browser contracts", () => {
    const violations = [...STABLE_UI_BROWSER_MODULES]
      .filter((filePath) => GRAPH.referencesIdentifier(filePath, "PubkyAuthApprovalCapability"))
      .map((filePath) => `${relative(REPO_ROOT, filePath)} references the sensitive browser approval type`);

    expect(violations).toEqual([]);
  });

});

function inspectUiBrowserImports(filePath: string): string[] {
  const relativeFilePath = relative(REPO_ROOT, filePath);
  const violations = GRAPH.referencesIdentifier(filePath, "PubkyAuthApprovalCapability")
    ? [`${relativeFilePath} references the sensitive browser approval type`]
    : [];
  const visited = new Set<string>();

  const inspect = (currentFilePath: string): void => {
    if (visited.has(currentFilePath)) return;
    visited.add(currentFilePath);

    for (const specifier of GRAPH.importSpecifiers(currentFilePath)) {
      const targetPath = GRAPH.resolveLocalImportTarget(currentFilePath, specifier);
      if (!targetPath) continue;
      if (isSameOrInside(targetPath, BROWSER_ROOT)) {
        if (!isStableUiBrowserModule(targetPath)) {
          violations.push(`${relativeFilePath} reaches non-public browser module via "${specifier}" from ${relative(REPO_ROOT, currentFilePath)}`);
        }
        continue;
      }
      inspect(targetPath);
    }
  };

  inspect(filePath);
  return violations;
}

function isStableUiBrowserModule(filePath: string): boolean {
  return STABLE_UI_BROWSER_MODULES.has(filePath);
}

function runtimeIsolationViolations(
  rootPath: string,
  forbiddenTargets: ForbiddenTarget[],
  forbiddenModuleSpecifiers: string[],
): string[] {
  return GRAPH.productionSourceFiles(rootPath).flatMap((filePath) => GRAPH.inspectForbiddenImports(filePath, {
    forbiddenModuleSpecifiers,
    forbiddenTargets,
    traverseLocalImports: true,
  }));
}

function missingOpeningRuntimeMarkers(
  rootPath: string,
  runtimeMarker: "client-only" | "server-only",
): string[] {
  return GRAPH.productionSourceFiles(rootPath)
    .filter((filePath) => !GRAPH.hasOpeningImport(filePath, runtimeMarker))
    .map((filePath) => `${relative(REPO_ROOT, filePath)} must start with import "${runtimeMarker}"`);
}

function isClientModule(filePath: string): boolean {
  return GRAPH.hasOpeningDirective(filePath, "use client");
}
