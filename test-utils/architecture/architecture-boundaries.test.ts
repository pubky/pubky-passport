import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isSameOrInside, ModuleGraph, type ForbiddenTarget } from "./ModuleGraph";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_ROOT = join(REPO_ROOT, "src");
const CLIENT_ROOT = join(SRC_ROOT, "client");
const CLIENT_LOGIC_ROOT = join(CLIENT_ROOT, "logic");
const SERVER_ROOT = join(SRC_ROOT, "server");
const APP_ROOT = join(SRC_ROOT, "app");
const UI_ROOT = join(CLIENT_ROOT, "ui");
const LIBS_ROOT = join(SRC_ROOT, "libs");
const PUBLIC_ENV_ROOT = join(LIBS_ROOT, "env");
const SERVER_CONFIG_ROOT = join(SERVER_ROOT, "config");
const LOCAL_IDENTITY_ROOT = join(CLIENT_LOGIC_ROOT, "local-identity");
const LOCAL_IDENTITY_REPOSITORY = join(LOCAL_IDENTITY_ROOT, "LocalStorageIdentityRepository.ts");
const PUBKY_SDK_ADAPTER = join(CLIENT_LOGIC_ROOT, "pubky", "PubkySdkAdapter.ts");
const PUBKY_SDK_ADAPTER_TEST = join(CLIENT_LOGIC_ROOT, "pubky", "pubkySdkAdapter.test.ts");
const PUBKY_SDK_ADAPTER_STAGING_TEST = join(CLIENT_LOGIC_ROOT, "pubky", "pubkySdkAdapter.staging.test.ts");
const SECRET_BEARING_BROWSER_CAPABILITIES = new Map([
  [LOCAL_IDENTITY_REPOSITORY, "local identity secret reads"],
  [join(CLIENT_LOGIC_ROOT, "google-identity", "GoogleImplicitAuthorization.ts"), "Google credentials"],
  [join(CLIENT_LOGIC_ROOT, "google-identity", "GoogleIdentityOperations.ts"), "Google identity credentials and keys"],
  [join(CLIENT_LOGIC_ROOT, "homegate", "HomegateClient.ts"), "Google ID-token transport"],
  [join(CLIENT_LOGIC_ROOT, "wrapping-key", "WrappingKeyApiClient.ts"), "wrapping-key transport"],
  [join(CLIENT_LOGIC_ROOT, "passport-file", "PassportFileWebCrypto.ts"), "Passport file cryptography"],
  [join(CLIENT_LOGIC_ROOT, "passport-file", "google", "PassportFileStore.ts"), "Drive credentials and Passport files"],
  [join(CLIENT_LOGIC_ROOT, "passport-file", "google", "VisibleRecoveryCopies.ts"), "Drive credentials and recovery files"],
  [PUBKY_SDK_ADAPTER, "Pubky key handles"],
]);
const ISSUED_AUTHORIZATION_REQUEST = join(
  CLIENT_LOGIC_ROOT,
  "authorization",
  "IssuedPubkyAuthRequest.ts",
);
const PASSPORT_AUTHORIZATION = join(
  CLIENT_LOGIC_ROOT,
  "authorization",
  "PassportAuthorizationController.ts",
);
const MANUAL_AUTHORIZATION_INPUT = join(
  CLIENT_LOGIC_ROOT,
  "authorization",
  "manualAuthorizationInput.ts",
);
const AUTHORIZATION_ENTRY = join(
  CLIENT_LOGIC_ROOT,
  "authorization",
  "authorizationEntry.ts",
);
const ENCODED_AUTHORIZATION_REQUEST_PARSER = join(
  CLIENT_LOGIC_ROOT,
  "authorization",
  "pubkyAuthRequestParser.ts",
);
const GOOGLE_WRAPPING_KEY_REQUEST = join(
  SERVER_ROOT,
  "wrapping-key",
  "google",
  "GoogleWrappingKeyRequest.ts",
);
const CLIENT_BOOTSTRAP_CONFIG = join(SERVER_CONFIG_ROOT, "browserBootstrapConfig.ts");
const GOOGLE_WRAPPING_KEY_ROUTE = join(APP_ROOT, "api", "wrapping-key", "google", "route.ts");
const APP_HOME_PAGE = join(APP_ROOT, "page.tsx");
const APP_AUTHORIZE_PAGE = join(APP_ROOT, "authorize", "page.tsx");
const PROXY = join(SRC_ROOT, "proxy.ts");
const GRAPH = new ModuleGraph(REPO_ROOT);

describe("architecture boundaries", () => {
  it("confines concrete Pubky SDK imports to the client Pubky adapter", () => {
    const violations = GRAPH.sourceFiles(SRC_ROOT)
      .filter((filePath) => GRAPH.importSpecifiers(filePath).some((specifier) =>
        specifier === "@synonymdev/pubky" || specifier.startsWith("@synonymdev/pubky/")
      ))
      .filter((filePath) =>
        filePath !== PUBKY_SDK_ADAPTER
        && filePath !== PUBKY_SDK_ADAPTER_TEST
        && filePath !== PUBKY_SDK_ADAPTER_STAGING_TEST
      )
      .map((filePath) => `${relative(REPO_ROOT, filePath)} imports @synonymdev/pubky outside the client Pubky adapter`);

    expect(violations).toEqual([]);
  });

  it("keeps client and server runtime code isolated", () => {
    const violations = [
      ...runtimeIsolationViolations(CLIENT_LOGIC_ROOT, [
        { targetPath: SERVER_ROOT, label: "server runtime" },
      ], ["server-only"]),
      ...runtimeIsolationViolations(SERVER_ROOT, [
        { targetPath: CLIENT_LOGIC_ROOT, label: "client logic runtime" },
        { targetPath: PUBLIC_ENV_ROOT, label: "public environment configuration" },
      ], ["client-only"]),
    ];

    expect(violations).toEqual([]);
  });

  it("starts every runtime module with its runtime marker", () => {
    const violations = [
      ...missingOpeningRuntimeMarkers(CLIENT_LOGIC_ROOT, "client-only"),
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

  it("limits client-side persistence to the local identity repository", () => {
    const clientCapableFiles = [
      ...GRAPH.productionSourceFiles(CLIENT_LOGIC_ROOT),
      ...GRAPH.productionSourceFiles(UI_ROOT),
      ...GRAPH.productionSourceFiles(APP_ROOT).filter(isClientModule),
    ];
    const violations = clientCapableFiles.flatMap((filePath) => [
      ...(filePath === LOCAL_IDENTITY_REPOSITORY || !GRAPH.referencesIdentifier(filePath, "localStorage")
        ? []
        : [`${relative(REPO_ROOT, filePath)} references forbidden client persistence "localStorage"`]),
      ...["sessionStorage", "indexedDB"]
        .filter((identifier) => GRAPH.referencesIdentifier(filePath, identifier))
        .map((identifier) => `${relative(REPO_ROOT, filePath)} references forbidden client persistence "${identifier}"`),
      ...(GRAPH.referencesProperty(filePath, "document", "cookie")
        ? [`${relative(REPO_ROOT, filePath)} references forbidden client persistence "document.cookie"`]
        : []),
      ...["localStorage", "sessionStorage", "indexedDB"]
        .filter((property) => GRAPH.referencesElementProperty(filePath, ["globalThis", "window"], property))
        .map((property) => `${relative(REPO_ROOT, filePath)} references forbidden computed client persistence "${property}"`),
      ...(GRAPH.referencesElementProperty(filePath, ["document"], "cookie")
        ? [`${relative(REPO_ROOT, filePath)} references forbidden computed client persistence "document.cookie"`]
        : []),
    ]);

    expect(violations).toEqual([]);
  });

  it("requires UI and app modules to opt into client rendering before importing client logic", () => {
    const violations = [
      ...GRAPH.productionSourceFiles(UI_ROOT),
      ...GRAPH.productionSourceFiles(APP_ROOT),
    ]
      .filter((filePath) => GRAPH.importsTarget(filePath, CLIENT_LOGIC_ROOT))
      .filter((filePath) => !isClientModule(filePath))
      .map((filePath) => `${relative(REPO_ROOT, filePath)} imports client logic without "use client"`);

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

  it("keeps secret-bearing browser capabilities out of UI modules", () => {
    expect([...SECRET_BEARING_BROWSER_CAPABILITIES.keys()]
      .filter((filePath) => !existsSync(filePath))
      .map((filePath) => relative(REPO_ROOT, filePath))).toEqual([]);

    const clientFacingFiles = [
      ...GRAPH.productionSourceFiles(UI_ROOT),
      ...GRAPH.productionSourceFiles(APP_ROOT).filter(isClientModule),
    ];
    const violations = clientFacingFiles.flatMap((filePath) =>
      [...SECRET_BEARING_BROWSER_CAPABILITIES].flatMap(([target, label]) =>
        GRAPH.importsTarget(filePath, target)
          ? [`${relative(REPO_ROOT, filePath)} directly imports ${label}`]
          : []
      )
    );

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
      [CLIENT_BOOTSTRAP_CONFIG, new Set([APP_HOME_PAGE, APP_AUTHORIZE_PAGE, PROXY])],
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

  it("keeps issued authorization requests out of UI modules", () => {
    const violations = GRAPH.productionSourceFiles(UI_ROOT)
      .filter((filePath) => GRAPH.referencesIdentifier(filePath, "IssuedPubkyAuthRequest"))
      .map((filePath) => `${relative(REPO_ROOT, filePath)} references the issued authorization request`);

    expect(violations).toEqual([]);
  });

  it("keeps authorization signing helpers out of UI modules", () => {
    const protectedIdentifiers = ["approveAuthorization", "restoreLocalIdentity"];
    const violations = GRAPH.productionSourceFiles(UI_ROOT).flatMap((filePath) =>
      protectedIdentifiers
        .filter((identifier) => GRAPH.referencesIdentifier(filePath, identifier))
        .map((identifier) => `${relative(REPO_ROOT, filePath)} references protected signing helper ${identifier}`)
    );

    expect(violations).toEqual([]);
  });

  it("confines issued authorization requests to their owning modules", () => {
    const approvedConsumers = new Set([
      AUTHORIZATION_ENTRY,
      MANUAL_AUTHORIZATION_INPUT,
      PASSPORT_AUTHORIZATION,
      PUBKY_SDK_ADAPTER,
    ]);
    const violations = GRAPH.productionSourceFiles(SRC_ROOT)
      .filter((filePath) => GRAPH.importsTarget(filePath, ISSUED_AUTHORIZATION_REQUEST))
      .filter((filePath) => !approvedConsumers.has(filePath))
      .map((filePath) => `${relative(REPO_ROOT, filePath)} imports the issued authorization request`);

    expect(violations).toEqual([]);
  });

  it("confines sensitive approval metadata access to its runtime owners", () => {
    const violations = GRAPH.productionSourceFiles(SRC_ROOT)
      .filter((filePath) => GRAPH.importsTarget(filePath, ISSUED_AUTHORIZATION_REQUEST))
      .flatMap((filePath) => [
        ...["validatedUrlForApproval", "isLive"]
          .filter((identifier) => filePath !== PUBKY_SDK_ADAPTER && GRAPH.referencesIdentifier(filePath, identifier))
          .map((identifier) => `${relative(REPO_ROOT, filePath)} accesses ${identifier} outside the Pubky adapter`),
        ...["takeOutcomeCallback"]
          .filter((identifier) => filePath !== PASSPORT_AUTHORIZATION && GRAPH.referencesIdentifier(filePath, identifier))
          .map((identifier) => `${relative(REPO_ROOT, filePath)} accesses ${identifier} outside the authorization controller`),
        ...["release"]
          .filter((identifier) =>
            filePath !== PASSPORT_AUTHORIZATION
            && filePath !== AUTHORIZATION_ENTRY
            && GRAPH.referencesIdentifier(filePath, identifier)
          )
          .map((identifier) => `${relative(REPO_ROOT, filePath)} accesses ${identifier} outside authorization lifetime owners`),
      ]);

    expect(violations).toEqual([]);
  });

  it("confines the sensitive authorization parser to issuance and safe validation", () => {
    const violations = GRAPH.productionSourceFiles(SRC_ROOT)
      .filter((filePath) => GRAPH.importsTarget(filePath, ENCODED_AUTHORIZATION_REQUEST_PARSER))
      .filter((filePath) => filePath !== ISSUED_AUTHORIZATION_REQUEST)
      .map((filePath) => `${relative(REPO_ROOT, filePath)} imports the sensitive authorization parser`);

    expect(violations).toEqual([]);
  });

});

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
