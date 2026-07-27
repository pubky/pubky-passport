import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";

import ts from "typescript";

import {
  isTestSourcePath,
  sourceExtensions,
} from "./architecturePolicy.mjs";

export type ForbiddenTarget = {
  targetPath: string;
  label: string;
};

export class ModuleGraph {
  readonly #compilerOptions: ts.CompilerOptions;
  readonly #sourceFiles = new Map<string, ts.SourceFile>();

  constructor(
    readonly repoRoot: string,
    tsconfigPath = resolve(repoRoot, "tsconfig.json"),
  ) {
    this.#compilerOptions = readCompilerOptions(tsconfigPath);
  }

  sourceFiles(rootPath: string): string[] {
    return walk(rootPath).filter((filePath) => sourceExtensions.includes(extname(filePath)));
  }

  productionSourceFiles(rootPath: string): string[] {
    return this.sourceFiles(rootPath).filter((filePath) => !isTestSourcePath(filePath));
  }

  importSpecifiers(filePath: string): string[] {
    return moduleLoadsFromSourceFile(this.sourceFile(filePath)).specifiers;
  }

  nonLiteralModuleLoads(filePath: string): string[] {
    return moduleLoadsFromSourceFile(this.sourceFile(filePath)).nonLiteralLoads;
  }

  resolveLocalImportTarget(fromFilePath: string, specifier: string): string | null {
    const resolved = ts.resolveModuleName(
      specifier,
      fromFilePath,
      this.#compilerOptions,
      ts.sys,
    ).resolvedModule?.resolvedFileName;
    if (!resolved || resolved.includes(`${sep}node_modules${sep}`)) return null;

    const normalized = resolve(resolved);
    return isSameOrInside(normalized, this.repoRoot) && existsSync(normalized)
      ? normalized
      : null;
  }

  inspectForbiddenImports(
    filePath: string,
    options: {
      forbiddenModuleSpecifiers?: string[];
      forbiddenTargets?: ForbiddenTarget[];
      traverseLocalImports?: boolean;
    },
  ): string[] {
    const relativeFilePath = relative(this.repoRoot, filePath);
    const violations: string[] = [];
    const visited = new Set<string>();

    const inspect = (currentFilePath: string): void => {
      if (visited.has(currentFilePath)) return;
      visited.add(currentFilePath);

      for (const specifier of this.importSpecifiers(currentFilePath)) {
        if (options.forbiddenModuleSpecifiers?.includes(specifier)) {
          const through = currentFilePath === filePath ? "" : ` through ${relative(this.repoRoot, currentFilePath)}`;
          violations.push(`${relativeFilePath} imports forbidden runtime marker "${specifier}"${through}`);
        }

        const targetPath = this.resolveLocalImportTarget(currentFilePath, specifier);
        if (!targetPath) continue;

        for (const forbiddenTarget of options.forbiddenTargets ?? []) {
          if (isSameOrInside(targetPath, forbiddenTarget.targetPath)) {
            const through = currentFilePath === filePath ? "" : ` through ${relative(this.repoRoot, currentFilePath)}`;
            violations.push(`${relativeFilePath} imports ${forbiddenTarget.label} via "${specifier}"${through}`);
          }
        }

        if (options.traverseLocalImports) inspect(targetPath);
      }
    };

    inspect(filePath);
    return violations;
  }

  importsTarget(filePath: string, targetRoot: string): boolean {
    return this.importSpecifiers(filePath).some((specifier) => {
      const targetPath = this.resolveLocalImportTarget(filePath, specifier);
      return targetPath !== null && isSameOrInside(targetPath, targetRoot);
    });
  }

  hasOpeningImport(filePath: string, moduleSpecifier: string): boolean {
    const firstStatement = this.sourceFile(filePath).statements[0];
    return firstStatement !== undefined
      && ts.isImportDeclaration(firstStatement)
      && ts.isStringLiteral(firstStatement.moduleSpecifier)
      && firstStatement.moduleSpecifier.text === moduleSpecifier
      && firstStatement.importClause === undefined;
  }

  hasOpeningDirective(filePath: string, directive: string): boolean {
    const firstStatement = this.sourceFile(filePath).statements[0];
    return firstStatement !== undefined
      && ts.isExpressionStatement(firstStatement)
      && ts.isStringLiteral(firstStatement.expression)
      && firstStatement.expression.text === directive;
  }

  referencesIdentifier(filePath: string, identifier: string): boolean {
    return sourceFileContains(this.sourceFile(filePath), (node) =>
      ts.isIdentifier(node) && node.text === identifier
    );
  }

  referencesProperty(filePath: string, objectName: string, propertyName: string): boolean {
    return sourceFileContains(this.sourceFile(filePath), (node) =>
      ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === objectName
      && node.name.text === propertyName
    );
  }

  referencesElementProperty(filePath: string, objectNames: string[], propertyName: string): boolean {
    return sourceFileContains(this.sourceFile(filePath), (node) => {
      if (!ts.isElementAccessExpression(node) || !ts.isIdentifier(node.expression)) return false;
      const argument = node.argumentExpression;
      return objectNames.includes(node.expression.text)
        && argument !== undefined
        && moduleSpecifierText(argument) === propertyName;
    });
  }

  private sourceFile(filePath: string): ts.SourceFile {
    const cached = this.#sourceFiles.get(filePath);
    if (cached) return cached;

    const sourceFile = ts.createSourceFile(
      filePath,
      readFileSync(filePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      scriptKind(filePath),
    );
    this.#sourceFiles.set(filePath, sourceFile);
    return sourceFile;
  }
}

export function importSpecifiersFromSource(source: string, fileName = "fixture.ts"): string[] {
  return moduleLoadsFromSourceFile(ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  )).specifiers;
}

export function nonLiteralModuleLoadsFromSource(source: string, fileName = "fixture.ts"): string[] {
  return moduleLoadsFromSourceFile(ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  )).nonLiteralLoads;
}

export function isSameOrInside(candidatePath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith(sep));
}

function moduleLoadsFromSourceFile(sourceFile: ts.SourceFile): {
  specifiers: string[];
  nonLiteralLoads: string[];
} {
  const specifiers: string[] = [];
  const nonLiteralLoads: string[] = [];

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteral(node.moduleReference.expression)) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const argument = node.arguments[0];
      const specifier = argument ? moduleSpecifierText(argument) : undefined;
      const hasSupportedArguments = isDynamicImport
        ? node.arguments.length >= 1
        : node.arguments.length === 1;
      if (specifier !== undefined && hasSupportedArguments) {
        specifiers.push(specifier);
      } else {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const kind = isDynamicImport ? "import" : "require";
        nonLiteralLoads.push(`${kind} at ${sourceFile.fileName}:${position.line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { specifiers, nonLiteralLoads };
}

function moduleSpecifierText(node: ts.Expression): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

function sourceFileContains(sourceFile: ts.SourceFile, predicate: (node: ts.Node) => boolean): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (predicate(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function readCompilerOptions(tsconfigPath: string): ts.CompilerOptions {
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error) throw new Error(formatDiagnostic(config.error));

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(tsconfigPath));
  if (parsed.errors.length > 0) throw new Error(parsed.errors.map(formatDiagnostic).join("\n"));
  return parsed.options;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

function walk(directoryPath: string): string[] {
  return readdirSync(directoryPath).flatMap((entry) => {
    const entryPath = resolve(directoryPath, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) return walk(entryPath);
    return stats.isFile() ? [entryPath] : [];
  });
}

function scriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
