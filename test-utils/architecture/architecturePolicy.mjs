export const sourceExtensions = Object.freeze([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
]);

export const browserControllerContract = "browser[A-Z][A-Za-z0-9]*Controller";
export const browserControllerFactory = "createBrowser[A-Z][A-Za-z0-9]*Controller";
export const browserControllerImplementation = "passport[A-Z][A-Za-z0-9]*Controller";
export const stableBrowserEntry = `(?:${browserControllerContract}|${browserControllerFactory})`;

const roleImportPatterns = Object.freeze({
  application: "(?:^|/)application(?:/|$)",
  adapter: "(?:^|/)adapters(?:/|$)",
  composition: `(?:^|/)composition(?:/|$)|(?:^|/)${browserControllerFactory}$`,
  controller: `(?:^|/)${browserControllerImplementation}$`,
  public: `(?:^|/)${browserControllerContract}$`,
});

export const browserRoleRules = Object.freeze([
  Object.freeze({
    id: "browser-application-inward",
    description: "keeps browser application modules independent from controllers and outward layers",
    sourceRole: "application",
    eslintFiles: ["src/browser/**/application/**/*.{js,jsx,mjs,cjs,ts,mts,cts,tsx}"],
    forbiddenRoles: ["adapter", "composition", "controller", "public"],
    forbiddenRoots: ["src/libs/env", "src/ui"],
    forbiddenSpecifiers: [],
    message: "Browser application modules must not depend on controllers, composition, adapters, public env, or UI.",
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

export function browserModuleRole(relativePath) {
  const segments = relativePath.replaceAll("\\", "/").split("/");
  if (segments.length === 2) {
    const fileName = segments[1] ?? "";
    if (new RegExp(`^${browserControllerContract}\\.(?:[cm]?[jt]sx?)$`, "u").test(fileName)) return "public";
    if (new RegExp(`^${browserControllerFactory}\\.(?:[cm]?[jt]sx?)$`, "u").test(fileName)) return "composition";
    if (new RegExp(`^${browserControllerImplementation}\\.(?:[cm]?[jt]sx?)$`, "u").test(fileName)) return "controller";
  }

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
    ...rule.forbiddenRoles.map((role) => roleImportPatterns[role]),
    ...rule.forbiddenRoots.map((root) => {
      const segment = root.split("/").at(-1) ?? root;
      return `(?:^|/)${escapeRegex(segment)}(?:/|$)`;
    }),
  ];
  return patterns.join("|");
}

export function isTestSourcePath(filePath) {
  return /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u.test(filePath);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
