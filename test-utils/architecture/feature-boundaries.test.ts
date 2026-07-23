import { readdirSync, readFileSync, statSync } from "node:fs";
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
const serverEnvModule = join(libsEnvRoot, "server-env");
const publicEnvModule = join(libsEnvRoot, "public-env");
const localIdentityRepository = join(browserRoot, "identity", "localIdentityRepository.ts");
const googleWrappingKeyRoot = join(serverRoot, "wrapping-key", "google");
const googleWrappingKeyApplicationModules = [
  join(googleWrappingKeyRoot, "applicationContracts.ts"),
  join(googleWrappingKeyRoot, "request.ts"),
];

const checkedExtensions = new Set([".ts", ".tsx"]);

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

function runtimeIsolationViolations(
  rootPath: string,
  forbiddenTargets: Array<{ targetPath: string; label: string }>,
  forbiddenModuleSpecifiers: string[],
): string[] {
  return productionSourceFiles(rootPath).flatMap((filePath) => inspectForbiddenImports(filePath, {
    forbiddenModuleSpecifiers,
    forbiddenTargets,
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
  },
): string[] {
  const relativeFilePath = relative(repoRoot, filePath);
  const violations: string[] = [];

  for (const specifier of importSpecifiers(readFileSync(filePath, "utf8"))) {
    if (options.forbiddenModuleSpecifiers?.includes(specifier)) {
      violations.push(`${relativeFilePath} imports forbidden runtime marker "${specifier}"`);
    }

    const targetPath = importTargetPath(filePath, specifier);
    if (!targetPath) {
      continue;
    }

    for (const forbiddenTarget of options.forbiddenTargets ?? []) {
      if (isSameOrInside(targetPath, forbiddenTarget.targetPath)) {
        violations.push(`${relativeFilePath} imports ${forbiddenTarget.label} via "${specifier}"`);
      }
    }
  }

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

function importsTarget(filePath: string, targetRoot: string): boolean {
  return importSpecifiers(readFileSync(filePath, "utf8")).some((specifier) => {
    const targetPath = importTargetPath(filePath, specifier);
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
