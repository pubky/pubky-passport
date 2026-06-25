import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = join(repoRoot, "src");
const coreRoot = join(srcRoot, "core");

const checkedExtensions = new Set([".ts", ".tsx"]);

const forbiddenAliasImports = [
  "next",
  "next/",
  "react",
  "react/",
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
  return walk(coreRoot).filter((filePath) => checkedExtensions.has(extension(filePath)));
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
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(importPattern)) {
    specifiers.push(match[1] ?? match[2]);
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
