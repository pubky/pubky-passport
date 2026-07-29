export const SOURCE_EXTENSIONS = Object.freeze([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
]);

export const BROWSER_CONTROLLER_CONTRACT = "browser[A-Z][A-Za-z0-9]*Controller";
export const BROWSER_CONTROLLER_FACTORY = "createBrowser[A-Z][A-Za-z0-9]*Controller";
export const BROWSER_CONTROLLER_IMPLEMENTATION = "passport[A-Z][A-Za-z0-9]*Controller";
export const STABLE_BROWSER_ENTRY = `(?:${BROWSER_CONTROLLER_CONTRACT}|${BROWSER_CONTROLLER_FACTORY})`;

const ROLE_IMPORT_PATTERNS = Object.freeze({
  application: "(?:^|/)application(?:/|$)",
  adapter: "(?:^|/)adapters(?:/|$)",
  composition: `(?:^|/)composition(?:/|$)|(?:^|/)${BROWSER_CONTROLLER_FACTORY}$`,
  controller: `(?:^|/)${BROWSER_CONTROLLER_IMPLEMENTATION}$`,
  public: `(?:^|/)${BROWSER_CONTROLLER_CONTRACT}$`,
});

const ROLE_PATH_SEGMENTS = Object.freeze({
  application: "application",
  adapter: "adapters",
  composition: "composition",
  controller: BROWSER_CONTROLLER_IMPLEMENTATION,
  public: BROWSER_CONTROLLER_CONTRACT,
});

export const BROWSER_ROLE_RULES = Object.freeze([
  Object.freeze({
    id: "browser-application-inward",
    description: "keeps browser application modules independent from controllers and composition",
    sourceRole: "application",
    eslintFiles: ["src/browser/**/application/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    forbiddenRoles: ["composition", "controller", "public"],
    forbiddenRoots: ["src/libs/env", "src/ui"],
    forbiddenSpecifiers: [],
    message: "Browser application modules may use adapters but must not depend on controllers, public controller contracts, composition roots, public environment configuration, or UI.",
  }),
  Object.freeze({
    id: "browser-public-contract-inward",
    description: "keeps public browser contracts independent from concrete controllers and outward layers",
    sourceRole: "public",
    eslintFiles: ["src/browser/*/browser*Controller.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    forbiddenRoles: ["adapter", "composition", "controller"],
    forbiddenRoots: ["src/libs/env", "src/ui"],
    forbiddenSpecifiers: [],
    message: "Public browser controller contracts must not depend on concrete controllers, composition, adapters, public env, or UI.",
  }),
  Object.freeze({
    id: "browser-controller-inward",
    description: "keeps browser controllers independent from composition and adapters",
    sourceRole: "controller",
    eslintFiles: ["src/browser/*/passport*Controller.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    forbiddenRoles: ["adapter", "composition"],
    forbiddenRoots: ["src/libs/env", "src/ui"],
    forbiddenSpecifiers: [],
    message: "Browser controllers may depend on public and application contracts, not composition, adapters, public env, or UI.",
  }),
  Object.freeze({
    id: "browser-adapter-inward",
    description: "keeps browser adapters independent from composition, env, UI, and server code",
    sourceRole: "adapter",
    eslintFiles: ["src/browser/**/adapters/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    forbiddenRoles: ["adapter", "composition", "controller", "public"],
    forbiddenRoots: ["src/libs/env", "src/ui", "src/server"],
    forbiddenSpecifiers: ["server-only"],
    message: "Browser adapters may depend on application contracts, not controllers, UI, composition roots, or runtime configuration.",
  }),
  Object.freeze({
    id: "browser-composition-runtime",
    description: "keeps browser composition roots independent from UI and server code",
    sourceRole: "composition",
    eslintFiles: [
      "src/browser/**/composition/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
      "src/browser/*/createBrowser*Controller.{js,jsx,mjs,cjs,ts,mts,cts,tsx}",
    ],
    forbiddenRoles: [],
    forbiddenRoots: ["src/ui", "src/server"],
    forbiddenSpecifiers: ["server-only"],
    message: "Browser composition roots may wire browser features but must not depend on UI or server runtime code.",
  }),
]);

export const SERVER_ROLE_RULES = Object.freeze([
  Object.freeze({
    id: "server-application-inward",
    description: "keeps server application modules independent from runtime implementation",
    sourceRole: "application",
    eslintFiles: ["src/server/**/application/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    forbiddenRoles: ["adapter", "composition"],
    forbiddenRoots: ["src/app", "src/ui", "src/browser", "src/server/config"],
    forbiddenSpecifiers: [],
    message: "Server application modules must not depend on adapters, composition, runtime configuration, app, UI, or browser code.",
  }),
  Object.freeze({
    id: "server-adapter-inward",
    description: "keeps server adapters independent from composition and outward runtimes",
    sourceRole: "adapter",
    eslintFiles: ["src/server/**/adapters/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    forbiddenRoles: ["composition"],
    forbiddenRoots: ["src/app", "src/ui", "src/browser", "src/server/config"],
    forbiddenSpecifiers: ["client-only"],
    message: "Server adapters may depend on application contracts, not composition, runtime configuration, app, UI, or browser code.",
  }),
  Object.freeze({
    id: "server-composition-runtime",
    description: "keeps server composition roots independent from outward application layers",
    sourceRole: "composition",
    eslintFiles: ["src/server/**/composition/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    forbiddenRoles: [],
    forbiddenRoots: ["src/app", "src/ui", "src/browser"],
    forbiddenSpecifiers: ["client-only"],
    message: "Server composition roots may wire server features but must not depend on app, UI, or browser code.",
  }),
]);

export const APP_SERVER_ENTRY_RULE = Object.freeze({
  id: "app-server-entry",
  description: "keeps app routes from bypassing layered server entry points",
  eslintFiles: ["src/app/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
  forbiddenRoles: ["adapter"],
  message: "App modules must enter layered server features through application contracts or composition, not adapters.",
});

export function browserModuleRole(relativePath) {
  const segments = relativePath.replaceAll("\\", "/").split("/");
  if (segments.length === 2) {
    const fileName = segments[1] ?? "";
    if (new RegExp(`^${BROWSER_CONTROLLER_CONTRACT}\\.(?:[cm]?[jt]sx?)$`, "u").test(fileName)) return "public";
    if (new RegExp(`^${BROWSER_CONTROLLER_FACTORY}\\.(?:[cm]?[jt]sx?)$`, "u").test(fileName)) return "composition";
    if (new RegExp(`^${BROWSER_CONTROLLER_IMPLEMENTATION}\\.(?:[cm]?[jt]sx?)$`, "u").test(fileName)) return "controller";
  }

  const roles = [
    segments.includes("application") ? "application" : null,
    segments.includes("adapters") ? "adapter" : null,
    segments.includes("composition") ? "composition" : null,
  ].filter(Boolean);
  return roles.length === 1 ? roles[0] : "unclassified";
}

export function serverModuleRole(relativePath) {
  const segments = relativePath.replaceAll("\\", "/").split("/");
  const roles = [
    segments.includes("application") ? "application" : null,
    segments.includes("adapters") ? "adapter" : null,
    segments.includes("composition") ? "composition" : null,
  ].filter(Boolean);
  return roles.length === 1 ? roles[0] : "unclassified";
}

export function restrictedImportRegexForRoleRule(rule) {
  const patterns = [
    ...rule.forbiddenSpecifiers.map((specifier) => `^${escapeRegex(specifier)}$`),
    ...rule.forbiddenRoles.map((role) => ROLE_IMPORT_PATTERNS[role]),
    ...rule.forbiddenRoots.flatMap(restrictedRootImportPatterns),
  ];
  return patterns.join("|");
}

export function restrictedServerImportRegexForAppRule(rule) {
  const forbiddenSegments = rule.forbiddenRoles.map((role) => ROLE_PATH_SEGMENTS[role]);
  return `^(?:@/server/|(?:\\.\\./)+server/)(?:[^/]+/)*(?:${forbiddenSegments.join("|")})(?:/|$)`;
}

export function isTestSourcePath(filePath) {
  return /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u.test(filePath);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function restrictedRootImportPatterns(root) {
  const normalizedRoot = root.replaceAll("\\", "/");
  if (!normalizedRoot.startsWith("src/")) {
    return [`^${escapeRegex(normalizedRoot)}(?:/|$)`];
  }

  const sourceRoot = normalizedRoot.slice("src/".length);
  return [
    `^@/${escapeRegex(sourceRoot)}(?:/|$)`,
    `^(?:\\.\\./)+${escapeRegex(normalizedRoot)}(?:/|$)`,
  ];
}
