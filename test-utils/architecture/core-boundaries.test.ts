import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = join(repoRoot, "src");
const coreRoot = join(srcRoot, "core");
const browserInfrastructureRoot = join(srcRoot, "infrastructure", "browser");
const serverInfrastructureRoot = join(srcRoot, "infrastructure", "server");
const compositionRoot = join(srcRoot, "infrastructure", "composition");
const appRoot = join(srcRoot, "app");
const uiRoot = join(srcRoot, "ui");
const libsEnvRoot = join(srcRoot, "libs", "env");
const serverEnvModule = join(libsEnvRoot, "server");
const publicEnvModule = join(libsEnvRoot, "public");

const checkedExtensions = new Set([".ts", ".tsx"]);

const forbiddenAliasImports = [
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
  "@/app/",
  "@/ui/",
  "@/infrastructure/",
  "@/libs/env/",
];

const forbiddenRelativeTargets = [
  join(srcRoot, "app"),
  join(srcRoot, "ui"),
  join(srcRoot, "infrastructure"),
  join(srcRoot, "libs", "env"),
];

const forbiddenRuntimePatterns = [
  { pattern: /\bprocess\.env\b/, label: "process.env" },
  { pattern: /\bwindow\b/, label: "window" },
  { pattern: /\bdocument\b/, label: "document" },
  { pattern: /\blocalStorage\b/, label: "localStorage" },
];

describe("core architecture boundaries", () => {
  it("keeps src/core independent from framework, UI, infrastructure, env, and browser globals", () => {
    const violations = coreSourceFiles().flatMap((filePath) => inspectCoreFile(filePath));

    expect(violations).toEqual([]);
  });

  it("keeps concrete Pubky SDK imports confined to browser Pubky infrastructure", () => {
    const violations = sourceFiles(srcRoot)
      .filter((filePath) => importsPubkySdk(filePath))
      .filter((filePath) => !isSameOrInside(filePath, join(srcRoot, "infrastructure", "browser", "pubky")))
      .map((filePath) => `${relative(repoRoot, filePath)} imports @synonymdev/pubky outside browser Pubky infrastructure`);

    expect(violations).toEqual([]);
  });

  it("forbids concrete Google SDK and server-only imports from core", () => {
    expect(isForbiddenAliasImport("google-auth-library")).toBe(true);
    expect(isForbiddenAliasImport("google-auth-library/build/src/auth/oauth2client")).toBe(true);
    expect(isForbiddenAliasImport("googleapis")).toBe(true);
    expect(isForbiddenAliasImport("googleapis/build/src/apis/drive")).toBe(true);
    expect(isForbiddenAliasImport("server-only")).toBe(true);
  });

  it("keeps browser infrastructure out of server-only code", () => {
    const violations = productionSourceFiles(serverInfrastructureRoot).flatMap((filePath) =>
      inspectForbiddenImports(filePath, {
        forbiddenModuleSpecifiers: ["client-only"],
        forbiddenTargets: [
          { targetPath: browserInfrastructureRoot, label: "browser infrastructure" },
          { targetPath: publicEnvModule, label: "public env module" },
        ],
      }),
    );

    expect(violations).toEqual([]);
  });

  it("keeps server infrastructure out of browser-only code", () => {
    const violations = productionSourceFiles(browserInfrastructureRoot).flatMap((filePath) =>
      inspectForbiddenImports(filePath, {
        forbiddenModuleSpecifiers: ["server-only"],
        forbiddenTargets: [
          { targetPath: serverInfrastructureRoot, label: "server infrastructure" },
          { targetPath: serverEnvModule, label: "server env module" },
        ],
      }),
    );

    expect(violations).toEqual([]);
  });

  it("keeps server-only dependencies out of UI code", () => {
    const violations = productionSourceFiles(uiRoot).flatMap((filePath) =>
      inspectForbiddenImports(filePath, {
        forbiddenModuleSpecifiers: ["server-only"],
        forbiddenTargets: [
          { targetPath: serverInfrastructureRoot, label: "server infrastructure" },
          { targetPath: serverEnvModule, label: "server env module" },
        ],
      }),
    );

    expect(violations).toEqual([]);
  });

  it("limits server env imports to server-capable layers", () => {
    const allowedImporters = [appRoot, serverInfrastructureRoot, compositionRoot, libsEnvRoot];
    const violations = productionSourceFiles(srcRoot)
      .filter((filePath) => !allowedImporters.some((allowedRoot) => isSameOrInside(filePath, allowedRoot)))
      .flatMap((filePath) =>
        inspectForbiddenImports(filePath, {
          forbiddenTargets: [{ targetPath: serverEnvModule, label: "server env module" }],
        }),
      );

    expect(violations).toEqual([]);
  });

  it("marks runtime-pinned infrastructure adapters explicitly", () => {
    const violations = [
      ...missingRuntimeMarkers(serverInfrastructureRoot, "server-only"),
      ...missingRuntimeMarkers(browserInfrastructureRoot, "client-only"),
    ];

    expect(violations).toEqual([]);
  });
});

function inspectCoreFile(filePath: string): string[] {
  const source = readFileSync(filePath, "utf8");
  const relativeFilePath = relative(repoRoot, filePath);
  const violations: string[] = [];

  for (const specifier of importSpecifiers(source)) {
    if (isForbiddenAliasImport(specifier) || isForbiddenRelativeImport(filePath, specifier)) {
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

function coreSourceFiles(): string[] {
  return sourceFiles(coreRoot);
}

function sourceFiles(rootPath: string): string[] {
  return walk(rootPath).filter((filePath) => checkedExtensions.has(extension(filePath)));
}

function productionSourceFiles(rootPath: string): string[] {
  return sourceFiles(rootPath).filter((filePath) => !filePath.endsWith(".test.ts") && !filePath.endsWith(".test.tsx"));
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

    if (stats.isFile()) {
      return [entryPath];
    }

    return [];
  });
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  // This test is the authoritative core boundary gate because ESLint cannot
  // resolve every relative import escape. The regex intentionally covers ESM
  // import/export and dynamic import only; require() is not scanned. Runtime
  // checks below strip comments but not string literals, so literal-only
  // mentions of globals can still produce false positives. If core grows beyond
  // this heuristic, prefer a parser-backed rule such as eslint-plugin-boundaries
  // or import/no-restricted-paths.
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function isForbiddenAliasImport(specifier: string): boolean {
  return forbiddenAliasImports.some((forbidden) => {
    if (forbidden.endsWith("/")) {
      return specifier.startsWith(forbidden);
    }

    return specifier === forbidden;
  });
}

function importsPubkySdk(filePath: string): boolean {
  return importSpecifiers(readFileSync(filePath, "utf8")).includes("@synonymdev/pubky");
}

function importTargetPath(fromFilePath: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) {
    return normalize(join(srcRoot, specifier.slice(2)));
  }

  if (specifier.startsWith(".")) {
    return normalize(resolve(dirname(fromFilePath), specifier));
  }

  return null;
}

function isForbiddenRelativeImport(fromFilePath: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) {
    return false;
  }

  const targetPath = normalize(resolve(dirname(fromFilePath), specifier));

  return forbiddenRelativeTargets.some((forbiddenTarget) => isSameOrInside(targetPath, forbiddenTarget));
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
