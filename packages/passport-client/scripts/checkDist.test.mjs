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
  return input;
};

test("accepts the scaffold and measures minified gzip bytes", () => {
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
  ['import "react/jsx-runtime";', "index"],
  ['import "@synonymdev/pubky/extra";', "flow/pubkyFlowAdapter"],
  ['import "/absolute.js";', "index"],
])("rejects an unapproved import %s in %s", (code, name) => {
  expect(() => checkDist(fixture(code, name))).toThrow(/import/);
});

test.each([
  ['import "@synonymdev/pubky";', "flow/pubkyFlowAdapter"],
  ['"use client"; import "react"; import "react/jsx-runtime";', "react"],
])("allows a peer only in its adapter: %s", (code, name) => {
  expect(() => checkDist(fixture(code, name))).not.toThrow();
});

test("requires the React client directive at the start", () => {
  expect(() => checkDist(fixture('import "react"; "use client";', "react"))).toThrow(/use client/);
});

test.each([
  (value) => {
    value.private = false;
  },
  (value) => {
    delete value.private;
  },
  (value) => {
    value.dependencies = { unexpected: "1.0.0" };
  },
  (value) => {
    value.peerDependencies.extra = "1";
  },
  (value) => {
    value.peerDependencies.react = ">=19";
  },
  (value) => {
    value.peerDependencies["@synonymdev/pubky"] = "*";
  },
  (value) => {
    value.peerDependenciesMeta.react.optional = false;
  },
  (value) => {
    value.peerDependenciesMeta["@synonymdev/pubky"] = { optional: true };
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

test("subtracts the static core closure from the React entry budget", () => {
  const input = fixture('export { data } from "./shared.js";');
  addModule(input, 'export const data = "small";', "shared");
  addModule(
    input,
    '"use client"; import { data } from "./index.js"; export const useClient = () => data;',
    "react",
  );
  const small = checkDist(input);
  input.files.set(
    "shared.js",
    `export const data = "${Array.from({ length: 1000 }, (_, i) => i.toString(36)).join("")}";`,
  );
  const large = checkDist(input);
  expect(large["react.js"]).toBe(small["react.js"]);
  expect(large["index.js"]).toBeGreaterThan(small["index.js"]);
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

test("cannot bypass an entry's checks by removing its public export", () => {
  const input = fixture();
  delete input.manifest.exports["./react"];
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
      "qr.js": 5120,
      "react.js": 3072,
      "extra.js": 1024,
    }),
  ).toThrow(/Missing required entry: extra.js/);
});
