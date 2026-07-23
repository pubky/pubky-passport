import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = join(repoRoot, "src");
const featuresRoot = join(srcRoot, "features");
const browserRoot = join(srcRoot, "browser");
const serverRoot = join(srcRoot, "server");
const appRoot = join(srcRoot, "app");
const uiRoot = join(srcRoot, "ui");
const libsEnvRoot = join(srcRoot, "libs", "env");
const serverEnvModule = join(libsEnvRoot, "server-env.ts");
const publicEnvModule = join(libsEnvRoot, "public-env.ts");
const localIdentityRepository = join(browserRoot, "identity", "localIdentityRepository.ts");
const browserPubky = join(browserRoot, "pubky", "browserPubky.ts");
const browserCompositionFactories = [
  join(browserRoot, "authorization", "createBrowserAuthorizationController.ts"),
  join(browserRoot, "identity", "createBrowserIdentityController.ts"),
];
const stableUiBrowserModules = new Set([
  join(browserRoot, "authorization", "browserAuthorizationController.ts"),
  join(browserRoot, "authorization", "createBrowserAuthorizationController.ts"),
  join(browserRoot, "identity", "browserIdentityController.ts"),
  join(browserRoot, "identity", "createBrowserIdentityController.ts"),
]);
const browserAdapterModules = [
  localIdentityRepository,
  browserPubky,
  join(browserRoot, "passport-file", "googleDrivePassportFileRepository.ts"),
  join(browserRoot, "passport-file", "webCryptoPassportFileCrypto.ts"),
  join(browserRoot, "identity", "google", "googleHomegateInviteRequester.ts"),
  join(browserRoot, "identity", "google", "googleIdentityProvider.ts"),
  join(browserRoot, "identity", "google", "googleIdentityProviderTypes.ts"),
  join(browserRoot, "identity", "google", "googleSignInWidget.ts"),
  join(browserRoot, "identity", "google", "googleWrappingKeyRequester.ts"),
];
const googleWrappingKeyRoot = join(serverRoot, "wrapping-key", "google");
const googleWrappingKeyApplicationModules = [
  join(googleWrappingKeyRoot, "ports.ts"),
  join(googleWrappingKeyRoot, "request.ts"),
];

const checkedExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const browserApplicationModules = productionSourceFiles(browserRoot)
  .filter((filePath) => !browserCompositionFactories.includes(filePath))
  .filter((filePath) => !browserAdapterModules.includes(filePath));

const forbiddenFeatureImports = [
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
  "@/libs/env/",
];

const forbiddenFeatureTargets = [
  appRoot,
  uiRoot,
  browserRoot,
  serverRoot,
  libsEnvRoot,
];

const forbiddenRuntimePatterns = [
  { pattern: /\bprocess\.env\b/, label: "process.env" },
  { pattern: /\bwindow\b/, label: "window" },
  { pattern: /\bdocument\b/, label: "document" },
  { pattern: /\blocalStorage\b/, label: "localStorage" },
];

const forbiddenBrowserPersistencePatterns = [
  { pattern: /\blocalStorage\b/, label: "localStorage" },
  { pattern: /\bsessionStorage\b/, label: "sessionStorage" },
  { pattern: /\bindexedDB\b/, label: "indexedDB" },
  { pattern: /\bdocument\.cookie\b/, label: "document.cookie" },
];

describe("feature runtime boundaries", () => {
  it("keeps features independent from framework, browser, server, env, and browser globals", () => {
    expect(sourceFiles(featuresRoot).flatMap(inspectFeatureFile)).toEqual([]);
  });

  it("confines concrete Pubky SDK imports to browser Pubky adapters", () => {
    const violations = sourceFiles(srcRoot)
      .filter(importsPubkySdk)
      .filter((filePath) => !isSameOrInside(filePath, join(browserRoot, "pubky")))
      .map((filePath) => `${relative(repoRoot, filePath)} imports @synonymdev/pubky outside browser Pubky adapters`);

    expect(violations).toEqual([]);
  });

  it("keeps browser and server runtime code isolated", () => {
    const violations = [
      ...runtimeIsolationViolations(browserRoot, [
        { targetPath: serverRoot, label: "server runtime" },
        { targetPath: serverEnvModule, label: "server env module" },
      ], ["server-only"]),
      ...runtimeIsolationViolations(serverRoot, [
        { targetPath: browserRoot, label: "browser runtime" },
        { targetPath: publicEnvModule, label: "public env module" },
      ], ["client-only"]),
    ];

    expect(violations).toEqual([]);
  });

  it("marks every runtime module explicitly", () => {
    const violations = [
      ...missingRuntimeMarkers(browserRoot, "client-only"),
      ...missingRuntimeMarkers(serverRoot, "server-only"),
    ];

    expect(violations).toEqual([]);
  });

  it("limits browser persistence to the local identity repository", () => {
    const browserCapableFiles = [
      ...productionSourceFiles(browserRoot),
      ...productionSourceFiles(uiRoot),
      ...productionSourceFiles(appRoot).filter(isClientModule),
    ];
    const violations = browserCapableFiles.flatMap((filePath) => {
      const source = sourceWithoutComments(readFileSync(filePath, "utf8"));

      return forbiddenBrowserPersistencePatterns
        .filter(({ label }) => filePath !== localIdentityRepository || label !== "localStorage")
        .filter(({ pattern }) => pattern.test(source))
        .map(({ label }) => `${relative(repoRoot, filePath)} references forbidden browser persistence "${label}"`);
    });

    expect(violations).toEqual([]);
  });

  it("requires UI and app modules to opt into client rendering before importing browser runtime", () => {
    const importers = [
      ...productionSourceFiles(uiRoot),
      ...productionSourceFiles(appRoot),
    ];
    const violations = importers
      .filter((filePath) => importsTarget(filePath, browserRoot))
      .filter((filePath) => !isClientModule(filePath))
      .map((filePath) => `${relative(repoRoot, filePath)} imports browser runtime without "use client"`);

    expect(violations).toEqual([]);
  });

  it("keeps server-only dependencies out of UI and client app modules", () => {
    const forbiddenTargets = [
      { targetPath: serverRoot, label: "server runtime" },
      { targetPath: serverEnvModule, label: "server env module" },
    ];
    const violations = [
      ...productionSourceFiles(uiRoot).flatMap((filePath) => inspectForbiddenImports(filePath, {
        forbiddenModuleSpecifiers: ["server-only"],
        forbiddenTargets,
      })),
      ...productionSourceFiles(appRoot)
        .filter(isClientModule)
        .flatMap((filePath) => inspectForbiddenImports(filePath, {
          forbiddenModuleSpecifiers: ["server-only"],
          forbiddenTargets,
        })),
    ];

    expect(violations).toEqual([]);
  });

  it("limits production UI browser imports to stable controller APIs and factories", () => {
    const violations = productionSourceFiles(uiRoot).flatMap(inspectUiBrowserImports);

    expect(violations).toEqual([]);
  });

  it("limits server environment imports to server-capable code", () => {
    const allowedImporters = [appRoot, serverRoot, libsEnvRoot];
    const violations = productionSourceFiles(srcRoot)
      .filter((filePath) => !allowedImporters.some((root) => isSameOrInside(filePath, root)))
      .flatMap((filePath) => inspectForbiddenImports(filePath, {
        forbiddenTargets: [{ targetPath: serverEnvModule, label: "server env module" }],
      }));

    expect(violations).toEqual([]);
  });

  it("keeps the Google wrapping-key application layer independent from configuration and adapters", () => {
    const forbiddenTargets = [
      { targetPath: serverEnvModule, label: "server env module" },
      { targetPath: join(googleWrappingKeyRoot, "composition"), label: "wrapping-key composition" },
      { targetPath: join(googleWrappingKeyRoot, "idTokenVerifier"), label: "Google verifier adapter" },
      { targetPath: join(googleWrappingKeyRoot, "keyDeriver"), label: "key derivation adapter" },
      { targetPath: join(googleWrappingKeyRoot, "rateLimiter"), label: "rate limiter adapter" },
    ];
    const violations = googleWrappingKeyApplicationModules.flatMap((filePath) =>
      inspectForbiddenImports(filePath, { forbiddenTargets })
    );

    expect(violations).toEqual([]);
  });

  it("keeps browser application layers independent from composition, adapters, env, and UI", () => {
    const forbiddenTargets = [
      ...browserCompositionFactories.map((targetPath) => ({ targetPath, label: "browser composition factory" })),
      ...browserAdapterModules.map((targetPath) => ({ targetPath, label: "browser adapter" })),
      { targetPath: publicEnvModule, label: "public env module" },
      { targetPath: uiRoot, label: "UI" },
    ];
    const violations = browserApplicationModules.flatMap((filePath) =>
      inspectForbiddenImports(filePath, { forbiddenTargets, traverseLocalImports: true })
    );

    expect(violations).toEqual([]);
  });

  it("defaults browser modules to application policy behind an exact detail allowlist", () => {
    const productionModules = new Set(productionSourceFiles(browserRoot));
    const allowlistedDetails = [...browserCompositionFactories, ...browserAdapterModules];

    expect(new Set(allowlistedDetails).size).toBe(allowlistedDetails.length);
    expect(allowlistedDetails.filter((filePath) => !productionModules.has(filePath))).toEqual([]);
    expect(browserApplicationModules).toEqual(
      [...productionModules].filter((filePath) => !allowlistedDetails.includes(filePath)),
    );
  });

  it("resolves aliases and transitive index re-exports for isolation checks", () => {
    expect(resolveLocalImportTarget(
      join(uiRoot, "authorizationReview.tsx"),
      "@/browser/authorization/browserAuthorizationController",
    )).toBe(join(browserRoot, "authorization", "browserAuthorizationController.ts"));

    const fixtureRoot = join(repoRoot, "test-utils", "architecture", "fixtures");
    const violations = inspectForbiddenImports(join(fixtureRoot, "transitive-entry.ts"), {
      forbiddenTargets: [{ targetPath: join(fixtureRoot, "server-target.ts"), label: "fixture server target" }],
      traverseLocalImports: true,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("fixture server target");
  });
});

function inspectFeatureFile(filePath: string): string[] {
  const source = readFileSync(filePath, "utf8");
  const relativeFilePath = relative(repoRoot, filePath);
  const violations: string[] = [];

  for (const specifier of importSpecifiers(source)) {
    if (isForbiddenFeatureImport(specifier) || isForbiddenRelativeImport(filePath, specifier)) {
      violations.push(`${relativeFilePath} imports forbidden dependency "${specifier}"`);
    }
  }

  for (const { pattern, label } of forbiddenRuntimePatterns) {
    if (pattern.test(sourceWithoutComments(source))) {
      violations.push(`${relativeFilePath} references forbidden runtime value "${label}"`);
    }
  }

  return violations;
}

function inspectUiBrowserImports(filePath: string): string[] {
  const relativeFilePath = relative(repoRoot, filePath);
  const source = readFileSync(filePath, "utf8");
  const violations = /\bValidatedSensitivePubkyAuthRequest\b/.test(sourceWithoutComments(source))
    ? [`${relativeFilePath} references the sensitive parser approval type`]
    : [];
  const visited = new Set<string>();

  function inspect(currentFilePath: string): void {
    if (visited.has(currentFilePath)) return;
    visited.add(currentFilePath);

    for (const specifier of importSpecifiers(readFileSync(currentFilePath, "utf8"))) {
      const targetPath = resolveLocalImportTarget(currentFilePath, specifier);
      if (!targetPath) continue;
      if (isSameOrInside(targetPath, browserRoot)) {
        if (!stableUiBrowserModules.has(targetPath)) {
          violations.push(`${relativeFilePath} reaches non-public browser module via "${specifier}" from ${relative(repoRoot, currentFilePath)}`);
        }
        continue;
      }
      inspect(targetPath);
    }
  }

  inspect(filePath);
  return violations;
}

function runtimeIsolationViolations(
  rootPath: string,
  forbiddenTargets: Array<{ targetPath: string; label: string }>,
  forbiddenModuleSpecifiers: string[],
): string[] {
  return productionSourceFiles(rootPath).flatMap((filePath) => inspectForbiddenImports(filePath, {
    forbiddenModuleSpecifiers,
    forbiddenTargets,
    traverseLocalImports: true,
  }));
}

function sourceFiles(rootPath: string): string[] {
  return walk(rootPath).filter((filePath) => checkedExtensions.has(extension(filePath)));
}

function productionSourceFiles(rootPath: string): string[] {
  return sourceFiles(rootPath).filter((filePath) => !filePath.endsWith(".test.ts") && !filePath.endsWith(".test.tsx"));
}

function isClientModule(filePath: string): boolean {
  return /^\s*["']use client["'];/.test(readFileSync(filePath, "utf8"));
}

function inspectForbiddenImports(
  filePath: string,
  options: {
    forbiddenModuleSpecifiers?: string[];
    forbiddenTargets?: Array<{ targetPath: string; label: string }>;
    traverseLocalImports?: boolean;
  },
): string[] {
  const relativeFilePath = relative(repoRoot, filePath);
  const violations: string[] = [];
  const visited = new Set<string>();

  function inspect(currentFilePath: string): void {
    if (visited.has(currentFilePath)) return;
    visited.add(currentFilePath);

    for (const specifier of importSpecifiers(readFileSync(currentFilePath, "utf8"))) {
      if (options.forbiddenModuleSpecifiers?.includes(specifier)) {
        const through = currentFilePath === filePath ? "" : ` through ${relative(repoRoot, currentFilePath)}`;
        violations.push(`${relativeFilePath} imports forbidden runtime marker "${specifier}"${through}`);
      }

      const targetPath = resolveLocalImportTarget(currentFilePath, specifier);
      if (!targetPath) continue;

      for (const forbiddenTarget of options.forbiddenTargets ?? []) {
        if (isSameOrInside(targetPath, forbiddenTarget.targetPath)) {
          const through = currentFilePath === filePath ? "" : ` through ${relative(repoRoot, currentFilePath)}`;
          violations.push(`${relativeFilePath} imports ${forbiddenTarget.label} via "${specifier}"${through}`);
        }
      }

      if (options.traverseLocalImports) {
        inspect(targetPath);
      }
    }
  }

  inspect(filePath);

  return violations;
}

function missingRuntimeMarkers(rootPath: string, runtimeMarker: "client-only" | "server-only"): string[] {
  return productionSourceFiles(rootPath)
    .filter((filePath) => !importSpecifiers(readFileSync(filePath, "utf8")).includes(runtimeMarker))
    .map((filePath) => `${relative(repoRoot, filePath)} is missing runtime marker import "${runtimeMarker}"`);
}

function walk(directoryPath: string): string[] {
  return readdirSync(directoryPath).flatMap((entry) => {
    const entryPath = join(directoryPath, entry);
    const stats = statSync(entryPath);

    if (stats.isDirectory()) {
      return walk(entryPath);
    }

    return stats.isFile() ? [entryPath] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function isForbiddenFeatureImport(specifier: string): boolean {
  return forbiddenFeatureImports.some((forbidden) => forbidden.endsWith("/") ? specifier.startsWith(forbidden) : specifier === forbidden);
}

function importsPubkySdk(filePath: string): boolean {
  return importSpecifiers(readFileSync(filePath, "utf8")).includes("@synonymdev/pubky");
}

function importTargetPath(fromFilePath: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) {
    return normalize(join(srcRoot, specifier.slice(2)));
  }

  return specifier.startsWith(".") ? normalize(resolve(dirname(fromFilePath), specifier)) : null;
}

function resolveLocalImportTarget(fromFilePath: string, specifier: string): string | null {
  const unresolvedPath = importTargetPath(fromFilePath, specifier);
  if (!unresolvedPath) return null;

  const candidates = extension(unresolvedPath)
      ? [unresolvedPath]
      : [
        `${unresolvedPath}.js`,
        `${unresolvedPath}.mjs`,
        `${unresolvedPath}.ts`,
        `${unresolvedPath}.tsx`,
        join(unresolvedPath, "index.js"),
        join(unresolvedPath, "index.mjs"),
        join(unresolvedPath, "index.ts"),
        join(unresolvedPath, "index.tsx"),
      ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function importsTarget(filePath: string, targetRoot: string): boolean {
  return importSpecifiers(readFileSync(filePath, "utf8")).some((specifier) => {
    const targetPath = resolveLocalImportTarget(filePath, specifier);
    return targetPath !== null && isSameOrInside(targetPath, targetRoot);
  });
}

function isForbiddenRelativeImport(fromFilePath: string, specifier: string): boolean {
  const targetPath = importTargetPath(fromFilePath, specifier);
  return targetPath !== null && forbiddenFeatureTargets.some((target) => isSameOrInside(targetPath, target));
}

function isSameOrInside(candidatePath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith(sep));
}

function extension(filePath: string): string {
  const dotIndex = filePath.lastIndexOf(".");
  return dotIndex === -1 ? "" : filePath.slice(dotIndex);
}

function sourceWithoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/(^|[^:])\/\/.*$/gm, "$1");
}
