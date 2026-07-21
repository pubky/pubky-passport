import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = join(repoRoot, "src");
const coreRoot = join(srcRoot, "core");
const browserAdaptersRoot = join(srcRoot, "adapters", "browser");
const serverAdaptersRoot = join(srcRoot, "adapters", "server");
const browserCompositionRoot = join(srcRoot, "composition", "browser");
const serverCompositionRoot = join(srcRoot, "composition", "server");
const appRoot = join(srcRoot, "app");
const uiRoot = join(srcRoot, "ui");
const libsEnvRoot = join(srcRoot, "libs", "env");
const serverEnvModule = join(libsEnvRoot, "server");
const publicEnvModule = join(libsEnvRoot, "public");

const checkedExtensions = new Set([".ts", ".tsx"]);

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
  "@/adapters/",
  "@/composition/",
  "@/libs/env/",
];

const forbiddenCoreTargets = [
  join(srcRoot, "app"),
  join(srcRoot, "ui"),
  join(srcRoot, "adapters"),
  join(srcRoot, "composition"),
  join(srcRoot, "libs", "env"),
];

const forbiddenRuntimePatterns = [
  { pattern: /\bprocess\.env\b/, label: "process.env" },
  { pattern: /\bwindow\b/, label: "window" },
  { pattern: /\bdocument\b/, label: "document" },
  { pattern: /\blocalStorage\b/, label: "localStorage" },
];

describe("runtime architecture boundaries", () => {
  it("keeps core independent from framework, runtime adapters, composition, env, and browser globals", () => {
    expect(coreSourceFiles().flatMap(inspectCoreFile)).toEqual([]);
  });

  it("confines concrete Pubky SDK imports to browser Pubky adapters", () => {
    const violations = sourceFiles(srcRoot)
      .filter(importsPubkySdk)
      .filter((filePath) => !isSameOrInside(filePath, join(browserAdaptersRoot, "pubky")))
      .map((filePath) => `${relative(repoRoot, filePath)} imports @synonymdev/pubky outside browser Pubky adapters`);

    expect(violations).toEqual([]);
  });

  it("keeps browser adapters out of server code", () => {
    expect(runtimeIsolationViolations(serverAdaptersRoot, [
      { targetPath: browserAdaptersRoot, label: "browser adapters" },
      { targetPath: publicEnvModule, label: "public env module" },
    ], ["client-only"])).toEqual([]);
  });

  it("keeps server adapters out of browser code", () => {
    expect(runtimeIsolationViolations(browserAdaptersRoot, [
      { targetPath: serverAdaptersRoot, label: "server adapters" },
      { targetPath: serverEnvModule, label: "server env module" },
    ], ["server-only"])).toEqual([]);
  });

  it("keeps browser and server composition isolated", () => {
    const violations = [
      ...runtimeIsolationViolations(serverCompositionRoot, [
        { targetPath: browserAdaptersRoot, label: "browser adapters" },
        { targetPath: browserCompositionRoot, label: "browser composition" },
        { targetPath: publicEnvModule, label: "public env module" },
      ], ["client-only"]),
      ...runtimeIsolationViolations(browserCompositionRoot, [
        { targetPath: serverAdaptersRoot, label: "server adapters" },
        { targetPath: serverCompositionRoot, label: "server composition" },
        { targetPath: serverEnvModule, label: "server env module" },
      ], ["server-only"]),
    ];

    expect(violations).toEqual([]);
  });

  it("marks adapters and composition with their runtime", () => {
    const violations = [
      ...missingRuntimeMarkers(serverAdaptersRoot, "server-only"),
      ...missingRuntimeMarkers(browserAdaptersRoot, "client-only"),
      ...missingRuntimeMarkers(serverCompositionRoot, "server-only"),
      ...missingRuntimeMarkers(browserCompositionRoot, "client-only"),
    ];

    expect(violations).toEqual([]);
  });

  it("keeps server-only dependencies out of UI code", () => {
    const violations = productionSourceFiles(uiRoot).flatMap((filePath) => inspectForbiddenImports(filePath, {
      forbiddenModuleSpecifiers: ["server-only"],
      forbiddenTargets: [
        { targetPath: serverAdaptersRoot, label: "server adapters" },
        { targetPath: serverCompositionRoot, label: "server composition" },
        { targetPath: serverEnvModule, label: "server env module" },
      ],
    }));

    expect(violations).toEqual([]);
  });

  it("keeps server-only dependencies out of client app modules", () => {
    const violations = productionSourceFiles(appRoot)
      .filter(isClientModule)
      .flatMap((filePath) => inspectForbiddenImports(filePath, {
        forbiddenModuleSpecifiers: ["server-only"],
        forbiddenTargets: [
          { targetPath: serverAdaptersRoot, label: "server adapters" },
          { targetPath: serverCompositionRoot, label: "server composition" },
          { targetPath: serverEnvModule, label: "server env module" },
        ],
      }));

    expect(violations).toEqual([]);
  });

  it("limits server env imports to server-capable code", () => {
    const allowedImporters = [appRoot, serverAdaptersRoot, serverCompositionRoot, libsEnvRoot];
    const violations = productionSourceFiles(srcRoot)
      .filter((filePath) => !allowedImporters.some((root) => isSameOrInside(filePath, root)))
      .flatMap((filePath) => inspectForbiddenImports(filePath, {
        forbiddenTargets: [{ targetPath: serverEnvModule, label: "server env module" }],
      }));

    expect(violations).toEqual([]);
  });
});

function inspectCoreFile(filePath: string): string[] {
  const source = readFileSync(filePath, "utf8");
  const relativeFilePath = relative(repoRoot, filePath);
  const violations: string[] = [];

  for (const specifier of importSpecifiers(source)) {
    if (isForbiddenCoreImport(specifier) || isForbiddenRelativeImport(filePath, specifier)) {
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

function coreSourceFiles(): string[] {
  return sourceFiles(coreRoot);
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

function isForbiddenCoreImport(specifier: string): boolean {
  return forbiddenCoreImports.some((forbidden) => forbidden.endsWith("/") ? specifier.startsWith(forbidden) : specifier === forbidden);
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

function isForbiddenRelativeImport(fromFilePath: string, specifier: string): boolean {
  const targetPath = importTargetPath(fromFilePath, specifier);
  return targetPath !== null && forbiddenCoreTargets.some((target) => isSameOrInside(targetPath, target));
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
