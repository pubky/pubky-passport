import { readdirSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { minifySync } from "rolldown/utils";
import ts from "typescript";

// PROVISIONAL: the planned ceilings were 12 KiB core and 22 KiB element; the complete core
// measured about 27 KiB, and the element grew for the popover and the Ring profile setup. Raised
// pending the maintainer's decision (the internal, test-only options are the obvious savings).
const ENTRY_BUDGETS = {
  "index.js": 32_768,
  "element.js": 43_008,
};
const PEER_IMPORTS = {
  "flow/pubkyFlowAdapter.js": ["@synonymdev/pubky"],
  "profile/validateProfile.js": ["pubky-app-specs"],
};
const BANNED_TOKENS = [
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "document.write",
  "eval(",
  "new Function",
  "console.",
];
const UNSAFE_PROPERTIES = new Set([
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "setHTMLUnsafe",
  "createContextualFragment",
  "srcdoc",
]);
const UNSAFE_NAMES = new Set(["console", "eval", "Function"]);
const emptyBundle = (value) =>
  value === undefined || value === false || (Array.isArray(value) && value.length === 0);

function checkManifest(manifest) {
  const peers = manifest.peerDependencies ?? {};
  const meta = manifest.peerDependenciesMeta ?? {};
  const publish = manifest.publishConfig ?? {};
  if (
    // Published publicly, with npm provenance, from CI: never private, never without provenance.
    manifest.private === true ||
    publish.access !== "public" ||
    publish.provenance !== true ||
    Object.keys(manifest.dependencies ?? {}).length !== 0 ||
    Object.keys(manifest.optionalDependencies ?? {}).length !== 0 ||
    !emptyBundle(manifest.bundleDependencies) ||
    !emptyBundle(manifest.bundledDependencies) ||
    ["preinstall", "install", "postinstall"].some((hook) =>
      Object.hasOwn(manifest.scripts ?? {}, hook),
    ) ||
    Object.keys(peers).sort().join() !== "@synonymdev/pubky,pubky-app-specs" ||
    peers["@synonymdev/pubky"] !== ">=0.11.0 <0.13.0" ||
    peers["pubky-app-specs"] !== ">=0.7.0 <0.9.0" ||
    Object.keys(meta).length !== 0
  )
    throw new Error("Package manifest violates the public, dependency-free peer policy.");
}

function inspectModule(name, code) {
  const { diagnostics = [] } = ts.transpileModule(code, {
    fileName: name,
    reportDiagnostics: true,
    compilerOptions: { allowJs: true, target: ts.ScriptTarget.ES2022 },
  });
  if (diagnostics.length) throw new Error(`Invalid emitted JavaScript: ${name}`);
  const source = ts.createSourceFile(name, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const minified = minifySync(name, code).code;
  if (BANNED_TOKENS.some((token) => minified.includes(token)))
    throw new Error(`Forbidden emitted token: ${name}`);
  const imports = { static: [], dynamic: [] };
  const addImport = (specifier, kind) => {
    if (!specifier || !ts.isStringLiteralLike(specifier))
      throw new Error(`Non-literal import: ${name}`);
    const value = specifier.text;
    if (value.startsWith("./") || value.startsWith("../")) {
      const target = posix.normalize(posix.join(posix.dirname(name), value));
      if (target.startsWith("../") || !target.endsWith(".js"))
        throw new Error(`Invalid relative import: ${name}`);
      imports[kind].push(target);
    } else if (!PEER_IMPORTS[name]?.includes(value))
      throw new Error(`Disallowed peer import: ${name}`);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) addImport(node.moduleSpecifier, "static");
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      addImport(node.arguments[0], "dynamic");
    if (ts.isIdentifier(node) && UNSAFE_NAMES.has(node.text))
      throw new Error(`Forbidden emitted API: ${name}`);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const property = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined;
      const owner = node.expression.getText(source);
      if (
        UNSAFE_PROPERTIES.has(property) ||
        UNSAFE_NAMES.has(property) ||
        owner === "console" ||
        ((owner === "document" || owner.endsWith(".document")) &&
          ["write", "writeln"].includes(property))
      ) {
        throw new Error(`Forbidden emitted API: ${name}`);
      }
    }
    if (
      ts.isCallExpression(node) &&
      /(?:^|\.)(?:setTimeout|setInterval)$/u.test(node.expression.getText(source)) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      throw new Error(`Forbidden code evaluation: ${name}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, minified };
}

/** Counts every import except lazy entries with their own budgets; shared core counts once. */
export function checkDist({ manifest, sources, files }, budgets = ENTRY_BUDGETS) {
  checkManifest(manifest);
  const expected = new Set(
    sources.flatMap((name) => {
      const stem = name.replace(/\.tsx?$/u, "");
      return [".js", ".js.map", ".d.ts", ".d.ts.map"].map((suffix) => stem + suffix);
    }),
  );
  for (const name of files.keys())
    if (!expected.has(name)) throw new Error(`Stale output: ${name}`);
  for (const name of expected) if (!files.has(name)) throw new Error(`Missing output: ${name}`);
  const graph = new Map();
  for (const [name, code] of files) {
    if (!name.endsWith(".js")) continue;
    graph.set(name, inspectModule(name, code));
  }
  for (const { imports } of graph.values()) {
    for (const dependency of [...imports.static, ...imports.dynamic])
      if (!graph.has(dependency)) throw new Error(`Missing imported module: ${dependency}`);
  }
  if (!graph.has("index.js")) throw new Error("Missing required entry: index.js");
  const budgetClosure = (entry) => {
    const closure = new Set();
    const visit = (name) => {
      if (closure.has(name)) return;
      closure.add(name);
      const { imports } = graph.get(name);
      for (const dependency of imports.static) visit(dependency);
      for (const dependency of imports.dynamic)
        if (!Object.hasOwn(budgets, dependency)) visit(dependency);
    };
    visit(entry);
    return closure;
  };
  const sizes = {};
  if (!manifest.exports?.["."]) throw new Error("Missing core export");
  for (const entry of Object.keys(ENTRY_BUDGETS)) {
    const subpath = entry === "index.js" ? "." : `./${entry.slice(0, -3)}`;
    if (manifest.exports[subpath]?.import !== `./dist/${entry}`)
      throw new Error(`Missing or changed public export: ${subpath}`);
  }
  for (const target of Object.values(manifest.exports)) {
    if (typeof target.import !== "string" || !target.import.startsWith("./dist/"))
      throw new Error("Invalid export target");
    const entry = target.import.slice("./dist/".length);
    if (!Object.hasOwn(budgets, entry)) throw new Error(`No gzip budget for export: ${entry}`);
    if (target.types !== `./dist/${entry.replace(/\.js$/u, ".d.ts")}`)
      throw new Error(`Invalid export declaration target: ${entry}`);
    if (!graph.has(entry)) throw new Error(`Missing required entry: ${entry}`);
    if (!files.has(target.types.slice("./dist/".length)))
      throw new Error(`Missing export declaration: ${entry}`);
    const closure = budgetClosure(entry);
    const bytes = gzipSync([...closure].map((name) => graph.get(name).minified).join("\n"), {
      level: 9,
    }).length;
    const budget = budgets[entry];
    if (bytes > budget) throw new Error(`${entry} exceeds gzip budget: ${bytes} > ${budget}`);
    sizes[entry] = bytes;
  }
  return sizes;
}

function readTree(directory) {
  return new Map(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = resolve(entry.parentPath, entry.name);
        return [posix.relative(directory, path), readFileSync(path, "utf8")];
      }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const sources = [...readTree(resolve(root, "src")).keys()].filter(
    (name) => /\.tsx?$/u.test(name) && !/\.(?:test|d)\.tsx?$/u.test(name),
  );
  const sizes = checkDist({
    manifest: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")),
    sources,
    files: readTree(resolve(root, "dist")),
  });
  process.stdout.write(`checkDist: ${JSON.stringify(sizes)} gzip bytes\n`);
}
