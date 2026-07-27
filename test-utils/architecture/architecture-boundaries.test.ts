import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  appServerEntryRule,
  browserModuleRole,
  browserRoleRules,
  serverModuleRole,
  serverRoleRules,
} from "./architecturePolicy.mjs";
import { isSameOrInside, ModuleGraph, type ForbiddenTarget } from "./moduleGraph";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = join(repoRoot, "src");
const coreRoot = join(srcRoot, "core");
const browserRoot = join(srcRoot, "browser");
const serverRoot = join(srcRoot, "server");
const appRoot = join(srcRoot, "app");
const uiRoot = join(srcRoot, "ui");
const libsRoot = join(srcRoot, "libs");
const publicEnvRoot = join(libsRoot, "env");
const identityRoot = join(browserRoot, "identity");
const localIdentityRepository = join(identityRoot, "local-identity", "adapters", "localStorageIdentityRepository.ts");
const pubkySdkAdaptersRoot = join(browserRoot, "pubky", "adapters");
const googleWrappingKeyRoot = join(serverRoot, "wrapping-key", "google");
const googleWrappingKeyConfig = join(googleWrappingKeyRoot, "composition", "googleWrappingKeyConfig.ts");
const googleWrappingKeyServerSecret = join(googleWrappingKeyRoot, "adapters", "serverSecret.ts");
const graph = new ModuleGraph(repoRoot);
const browserProductionModules = graph.productionSourceFiles(browserRoot);
const browserModulesByRole = Map.groupBy(
  browserProductionModules,
  (filePath) => browserModuleRole(relative(browserRoot, filePath)),
);
const serverProductionModules = graph.productionSourceFiles(serverRoot);
const serverModulesByRole = Map.groupBy(
  serverProductionModules,
  (filePath) => serverModuleRole(relative(serverRoot, filePath)),
);

const forbiddenCoreImports = [
  "@synonymdev/pubky",
  "google-auth-library",
  "google-auth-library/",
  "googleapis",
  "googleapis/",
  "next",
  "next/",
  "react",
  "react/",
  "server-only",
  "client-only",
  "@/app/",
  "@/ui/",
  "@/browser/",
  "@/server/",
  "@/libs/",
];

describe("architecture boundaries", () => {
  it("keeps core independent from frameworks, runtimes, libraries, config, and runtime globals", () => {
    expect(graph.sourceFiles(coreRoot).flatMap(inspectCoreFile)).toEqual([]);
  });

  it("confines concrete Pubky SDK imports to browser Pubky adapters", () => {
    const violations = graph.sourceFiles(srcRoot)
      .filter((filePath) => graph.importSpecifiers(filePath).some((specifier) =>
        specifier === "@synonymdev/pubky" || specifier.startsWith("@synonymdev/pubky/")
      ))
      .filter((filePath) => !isSameOrInside(filePath, pubkySdkAdaptersRoot))
      .map((filePath) => `${relative(repoRoot, filePath)} imports @synonymdev/pubky outside browser Pubky adapters`);

    expect(violations).toEqual([]);
  });

  it("keeps browser and server runtime code isolated", () => {
    const violations = [
      ...runtimeIsolationViolations(browserRoot, [
        { targetPath: serverRoot, label: "server runtime" },
      ], ["server-only"]),
      ...runtimeIsolationViolations(serverRoot, [
        { targetPath: browserRoot, label: "browser runtime" },
        { targetPath: publicEnvRoot, label: "public environment configuration" },
      ], ["client-only"]),
    ];

    expect(violations).toEqual([]);
  });

  it("starts every runtime module with its runtime marker", () => {
    const violations = [
      ...missingOpeningRuntimeMarkers(browserRoot, "client-only"),
      ...missingOpeningRuntimeMarkers(serverRoot, "server-only"),
    ];

    expect(violations).toEqual([]);
  });

  it("requires production module loads to use statically analyzable specifiers", () => {
    const violations = graph.productionSourceFiles(srcRoot).flatMap((filePath) =>
      graph.nonLiteralModuleLoads(filePath).map((load) =>
        `${relative(repoRoot, filePath)} contains non-literal ${load}`
      )
    );

    expect(violations).toEqual([]);
  });

  it("limits browser persistence to the local identity repository", () => {
    const browserCapableFiles = [
      ...graph.productionSourceFiles(browserRoot),
      ...graph.productionSourceFiles(uiRoot),
      ...graph.productionSourceFiles(appRoot).filter(isClientModule),
    ];
    const violations = browserCapableFiles.flatMap((filePath) => [
      ...(filePath === localIdentityRepository || !graph.referencesIdentifier(filePath, "localStorage")
        ? []
        : [`${relative(repoRoot, filePath)} references forbidden browser persistence "localStorage"`]),
      ...["sessionStorage", "indexedDB"]
        .filter((identifier) => graph.referencesIdentifier(filePath, identifier))
        .map((identifier) => `${relative(repoRoot, filePath)} references forbidden browser persistence "${identifier}"`),
      ...(graph.referencesProperty(filePath, "document", "cookie")
        ? [`${relative(repoRoot, filePath)} references forbidden browser persistence "document.cookie"`]
        : []),
      ...["localStorage", "sessionStorage", "indexedDB"]
        .filter((property) => graph.referencesElementProperty(filePath, ["globalThis", "window"], property))
        .map((property) => `${relative(repoRoot, filePath)} references forbidden computed browser persistence "${property}"`),
      ...(graph.referencesElementProperty(filePath, ["document"], "cookie")
        ? [`${relative(repoRoot, filePath)} references forbidden computed browser persistence "document.cookie"`]
        : []),
    ]);

    expect(violations).toEqual([]);
  });

  it("requires UI and app modules to opt into client rendering before importing browser runtime", () => {
    const violations = [
      ...graph.productionSourceFiles(uiRoot),
      ...graph.productionSourceFiles(appRoot),
    ]
      .filter((filePath) => graph.importsTarget(filePath, browserRoot))
      .filter((filePath) => !isClientModule(filePath))
      .map((filePath) => `${relative(repoRoot, filePath)} imports browser runtime without "use client"`);

    expect(violations).toEqual([]);
  });

  it("keeps server-only dependencies out of UI and client app modules", () => {
    const forbiddenTargets = [{ targetPath: serverRoot, label: "server runtime" }];
    const violations = [
      ...graph.productionSourceFiles(uiRoot),
      ...graph.productionSourceFiles(appRoot).filter(isClientModule),
    ].flatMap((filePath) => graph.inspectForbiddenImports(filePath, {
      forbiddenModuleSpecifiers: ["server-only"],
      forbiddenTargets,
    }));

    expect(violations).toEqual([]);
  });

  it(`${appServerEntryRule.id}: ${appServerEntryRule.description}`, () => {
    const violations = graph.productionSourceFiles(appRoot).flatMap((filePath) =>
      graph.importSpecifiers(filePath).flatMap((specifier) => {
        const targetPath = graph.resolveLocalImportTarget(filePath, specifier);
        if (!targetPath || !isSameOrInside(targetPath, serverRoot)) return [];

        const role = serverModuleRole(relative(serverRoot, targetPath));
        return appServerEntryRule.forbiddenRoles.some((forbiddenRole) => forbiddenRole === role)
          ? [`${relative(repoRoot, filePath)} imports server ${role} directly via "${specifier}"`]
          : [];
      })
    );

    expect(violations).toEqual([]);
  });

  it("limits production UI browser imports to stable controller APIs and factories", () => {
    expect(graph.productionSourceFiles(uiRoot).flatMap(inspectUiBrowserImports)).toEqual([]);
  });

  it("keeps wrapping-key configuration inside its owning server feature", () => {
    const forbiddenTargets = [
      { targetPath: googleWrappingKeyConfig, label: "Google wrapping-key config" },
      { targetPath: googleWrappingKeyServerSecret, label: "Google wrapping-key server secret" },
    ];
    const violations = graph.productionSourceFiles(srcRoot)
      .filter((filePath) => !isSameOrInside(filePath, googleWrappingKeyRoot))
      .flatMap((filePath) => graph.inspectForbiddenImports(filePath, { forbiddenTargets }));

    expect(violations).toEqual([]);
  });

  for (const rule of browserRoleRules) {
    it(`${rule.id}: ${rule.description}`, () => {
      const sourceModules = browserModulesByRole.get(rule.sourceRole) ?? [];
      const violations = sourceModules.flatMap((filePath) => {
        const forbiddenTargets: ForbiddenTarget[] = [
          ...rule.forbiddenRoles.flatMap((role) =>
            (browserModulesByRole.get(role) ?? [])
              .filter((targetPath) => targetPath !== filePath)
              .map((targetPath) => ({ targetPath, label: `browser ${role} module` }))
          ),
          ...rule.forbiddenRoots.map((root) => ({
            targetPath: resolve(repoRoot, root),
            label: root,
          })),
        ];
        return graph.inspectForbiddenImports(filePath, {
          forbiddenModuleSpecifiers: [...rule.forbiddenSpecifiers],
          forbiddenTargets,
          traverseLocalImports: true,
        });
      });

      expect(violations).toEqual([]);
    });
  }

  for (const rule of serverRoleRules) {
    it(`${rule.id}: ${rule.description}`, () => {
      const sourceModules = serverModulesByRole.get(rule.sourceRole) ?? [];
      const violations = sourceModules.flatMap((filePath) => {
        const forbiddenTargets: ForbiddenTarget[] = [
          ...rule.forbiddenRoles.flatMap((role) =>
            (serverModulesByRole.get(role) ?? [])
              .filter((targetPath) => targetPath !== filePath)
              .map((targetPath) => ({ targetPath, label: `server ${role} module` }))
          ),
          ...rule.forbiddenRoots.map((root) => ({
            targetPath: resolve(repoRoot, root),
            label: root,
          })),
        ];
        return graph.inspectForbiddenImports(filePath, {
          forbiddenModuleSpecifiers: [...rule.forbiddenSpecifiers],
          forbiddenTargets,
          traverseLocalImports: true,
        });
      });

      expect(violations).toEqual([]);
    });
  }

  it("keeps sensitive parser approval types out of public browser contracts", () => {
    const violations = (browserModulesByRole.get("public") ?? [])
      .filter((filePath) => graph.referencesIdentifier(filePath, "ValidatedSensitivePubkyAuthRequest"))
      .map((filePath) => `${relative(repoRoot, filePath)} references the sensitive parser approval type`);

    expect(violations).toEqual([]);
  });

  it("classifies every browser module by an explicit architectural role", () => {
    expect(browserModulesByRole.get("unclassified") ?? []).toEqual([]);
  });

  it("classifies every Google wrapping-key module by an explicit server role", () => {
    const unclassified = graph.productionSourceFiles(googleWrappingKeyRoot)
      .filter((filePath) => serverModuleRole(relative(serverRoot, filePath)) === "unclassified");

    expect(unclassified).toEqual([]);
  });

});

function inspectCoreFile(filePath: string): string[] {
  const relativeFilePath = relative(repoRoot, filePath);
  const violations = graph.importSpecifiers(filePath)
    .filter((specifier) => forbiddenCoreImports.some((forbidden) =>
      forbidden.endsWith("/") ? specifier.startsWith(forbidden) : specifier === forbidden
    ))
    .map((specifier) => `${relativeFilePath} imports forbidden dependency "${specifier}"`);
  const forbiddenTargets = [appRoot, uiRoot, browserRoot, serverRoot, libsRoot];

  for (const specifier of graph.importSpecifiers(filePath)) {
    const targetPath = graph.resolveLocalImportTarget(filePath, specifier);
    if (targetPath && forbiddenTargets.some((target) => isSameOrInside(targetPath, target))) {
      violations.push(`${relativeFilePath} imports forbidden dependency "${specifier}"`);
    }
  }

  const runtimeReferences = [
    ...(graph.referencesProperty(filePath, "process", "env") ? ["process.env"] : []),
    ...["window", "document", "localStorage"].filter((identifier) =>
      graph.referencesIdentifier(filePath, identifier)
    ),
  ];
  violations.push(...runtimeReferences.map((label) =>
    `${relativeFilePath} references forbidden runtime value "${label}"`
  ));
  return violations;
}

function inspectUiBrowserImports(filePath: string): string[] {
  const relativeFilePath = relative(repoRoot, filePath);
  const violations = graph.referencesIdentifier(filePath, "ValidatedSensitivePubkyAuthRequest")
    ? [`${relativeFilePath} references the sensitive parser approval type`]
    : [];
  const visited = new Set<string>();

  const inspect = (currentFilePath: string): void => {
    if (visited.has(currentFilePath)) return;
    visited.add(currentFilePath);

    for (const specifier of graph.importSpecifiers(currentFilePath)) {
      const targetPath = graph.resolveLocalImportTarget(currentFilePath, specifier);
      if (!targetPath) continue;
      if (isSameOrInside(targetPath, browserRoot)) {
        if (!isStableUiBrowserModule(targetPath)) {
          violations.push(`${relativeFilePath} reaches non-public browser module via "${specifier}" from ${relative(repoRoot, currentFilePath)}`);
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
  const role = browserModuleRole(relative(browserRoot, filePath));
  return (role === "public" || role === "composition")
    && relative(browserRoot, filePath).split(/[\\/]/u).length === 2;
}

function runtimeIsolationViolations(
  rootPath: string,
  forbiddenTargets: ForbiddenTarget[],
  forbiddenModuleSpecifiers: string[],
): string[] {
  return graph.productionSourceFiles(rootPath).flatMap((filePath) => graph.inspectForbiddenImports(filePath, {
    forbiddenModuleSpecifiers,
    forbiddenTargets,
    traverseLocalImports: true,
  }));
}

function missingOpeningRuntimeMarkers(
  rootPath: string,
  runtimeMarker: "client-only" | "server-only",
): string[] {
  return graph.productionSourceFiles(rootPath)
    .filter((filePath) => !graph.hasOpeningImport(filePath, runtimeMarker))
    .map((filePath) => `${relative(repoRoot, filePath)} must start with import "${runtimeMarker}"`);
}

function isClientModule(filePath: string): boolean {
  return graph.hasOpeningDirective(filePath, "use client");
}
