// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

import { checkDist } from "./checkDist.mjs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
function addModule(input, code, name) {
  input.sources.push(`${name}.ts`);
  for (const [suffix, content] of [
    [".js", code],
    [".js.map", "{}"],
    [".d.ts", "export {};"],
    [".d.ts.map", "{}"],
  ])
    input.files.set(name + suffix, content);
}
const fixture = (code = "export const value = 1;", name = "index") => {
  const input = { manifest: structuredClone(manifest), sources: [], files: new Map() };
  addModule(input, code, name);
  if (name !== "index") addModule(input, "export {};", "index");
  if (name !== "element") addModule(input, "export {};", "element");
  return input;
};

test("accepts implemented entries and measures minified gzip bytes", () => {
  expect(checkDist(fixture())["index.js"]).toBeGreaterThan(0);
});

test.each(
  readFileSync(new URL("../test/checkDist/banned.txt", import.meta.url), "utf8")
    .trim()
    .split("\n"),
)("rejects forbidden emitted code: %s", (code) => {
  expect(() => checkDist(fixture(code))).toThrow(/Forbidden/);
});

test("enforces the specified token ban even in non-executed strings", () => {
  expect(() => checkDist(fixture('export const text = "console.log( innerHTML eval(";'))).toThrow(
    /Forbidden/,
  );
});

test.each([
  ['import "unexpected";', "index"],
  ['export * from "unexpected";', "index"],
  ['import("unexpected");', "index"],
  ["import(name);", "index"],
  ['import "@synonymdev/pubky";', "index"],
  ['import "react";', "index"],
  ['import("pubky-app-specs");', "index"],
  ['import "pubky-app-specs";', "flow/pubkyFlowAdapter"],
  ['import "@synonymdev/pubky/extra";', "flow/pubkyFlowAdapter"],
  ['import "/absolute.js";', "index"],
])("rejects an unapproved import %s in %s", (code, name) => {
  expect(() => checkDist(fixture(code, name))).toThrow(/import/);
});

test.each([
  ['import "@synonymdev/pubky";', "flow/pubkyFlowAdapter"],
  ['export const load = () => import("pubky-app-specs");', "profile/validateProfile"],
])("allows a peer only in its adapter: %s", (code, name) => {
  expect(() => checkDist(fixture(code, name))).not.toThrow();
});

test.each([
  (value) => {
    value.private = true;
  },
  (value) => {
    delete value.publishConfig;
  },
  (value) => {
    value.publishConfig.access = "restricted";
  },
  (value) => {
    value.publishConfig.provenance = false;
  },
  (value) => {
    value.dependencies = { unexpected: "1.0.0" };
  },
  (value) => {
    value.peerDependencies.extra = "1";
  },
  (value) => {
    value.peerDependencies.react = ">=18";
  },
  (value) => {
    value.peerDependencies["pubky-app-specs"] = "*";
  },
  // The range its profile validation was checked against, no wider and no narrower.
  ...[">=0.7.0 <0.8.0", ">=0.7.0 <0.10.0", ">=0.8.0 <0.9.0"].map((range) => (value) => {
    value.peerDependencies["pubky-app-specs"] = range;
  }),
  (value) => {
    delete value.peerDependencies["pubky-app-specs"];
  },
  (value) => {
    value.peerDependencies["@synonymdev/pubky"] = "*";
  },
  (value) => {
    value.peerDependenciesMeta = { "pubky-app-specs": { optional: true } };
  },
  (value) => {
    value.optionalDependencies = { unexpected: "1" };
  },
  (value) => {
    value.bundleDependencies = ["unexpected"];
  },
  (value) => {
    value.bundledDependencies = true;
  },
  ...["preinstall", "install", "postinstall"].map((hook) => (value) => {
    value.scripts[hook] = "anything";
  }),
  (value) => {
    value.peerDependencies["@synonymdev/pubky"] = ">=0.11.0 <0.12.0";
  },
])("rejects a manifest policy violation %#", (change) => {
  const input = fixture();
  change(input.manifest);
  expect(() => checkDist(input)).toThrow(/manifest/);
});

test("rejects stale output and missing generated files", () => {
  const input = fixture();
  input.files.set("old.js", "export {};");
  expect(() => checkDist(input)).toThrow(/Stale/);
  input.files.delete("old.js");
  input.files.delete("index.d.ts.map");
  expect(() => checkDist(input)).toThrow(/Missing/);
});

test("follows static relative closures once, including cycles", () => {
  const input = fixture('import("./shared.js"); export { value } from "./shared.js";');
  addModule(input, 'import "./index.js"; export const value = "shared";', "shared");
  expect(checkDist(input)["index.js"]).toBeGreaterThan(checkDist(fixture())["index.js"]);
  expect(() => checkDist(input, { "index.js": 1 })).toThrow(/budget/);
});

test("checks dynamic imports without adding lazy entry code to the parent's budget", () => {
  const input = fixture('export const load = () => import("./element.js");');
  addModule(input, 'export const text = "small";', "element");
  const small = checkDist(input);
  input.files.set(
    "element.js",
    `export const text = "${Array.from({ length: 1000 }, (_, i) => i.toString(36)).join("")}";`,
  );
  const large = checkDist(input);
  expect(large["index.js"]).toBe(small["index.js"]);
  expect(large["element.js"]).toBeGreaterThan(small["element.js"]);
});

test("counts the whole closure of a large non-entry lazy module", () => {
  const input = fixture('export const load = () => import("./flow/lazy.js");');
  addModule(input, 'export { text } from "./payload.js";', "flow/lazy");
  addModule(
    input,
    `export const text = "${Array.from({ length: 20000 }, (_, i) => i.toString(36)).join("")}";`,
    "flow/payload",
  );
  expect(() => checkDist(input)).toThrow(/index.js exceeds gzip budget/);
});

test.each(['import "../outside.js";', 'import "./missing.js";', 'import "./data.json";'])(
  "rejects an invalid relative closure: %s",
  (code) => {
    expect(() => checkDist(fixture(code))).toThrow(/import/);
  },
);

test("rejects an unbudgeted export and a dangling declaration target", () => {
  const input = fixture();
  input.manifest.exports["./extra"] = { types: "./dist/index.d.ts", import: "./dist/extra.js" };
  expect(() => checkDist(input)).toThrow(/budget/);
  delete input.manifest.exports["./extra"];
  input.manifest.exports["."].types = "./dist/absent.d.ts";
  expect(() => checkDist(input)).toThrow(/export/);
});

test("requires the core entry even when all its sources are removed", () => {
  const input = fixture();
  input.sources = [];
  input.files.clear();
  expect(() => checkDist(input)).toThrow(/entry/);
});

test("requires the element entry even when its source is removed", () => {
  const input = fixture();
  input.sources = input.sources.filter((name) => name !== "element.ts");
  for (const name of input.files.keys()) if (name.startsWith("element.")) input.files.delete(name);
  expect(() => checkDist(input)).toThrow(/Missing required entry: element.js/);
});

test("cannot bypass an entry's checks by removing its public export", () => {
  const input = fixture();
  delete input.manifest.exports["./element"];
  expect(() => checkDist(input)).toThrow(/export/);
});

test("uses public syntax diagnostics for invalid JavaScript", () => {
  expect(() => checkDist(fixture("export const = ;"))).toThrow(/Invalid emitted/);
});

test("requires a budgeted non-pending export to exist", () => {
  const input = fixture();
  input.manifest.exports["./extra"] = {
    types: "./dist/extra.d.ts",
    import: "./dist/extra.js",
  };
  expect(() =>
    checkDist(input, {
      "index.js": 12288,
      "element.js": 22528,
      "extra.js": 1024,
    }),
  ).toThrow(/Missing required entry: extra.js/);
});
