// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const COMMIT = "3c6d0b3cefb4e049dc337e82237c9644399716a8";
const SHA256 = "1dc03fb5a10e0e2318ea162755bbdb9977ca6ce52cff959e9c9b6deafdccda9c";
const PREFIX = `// @ts-nocheck -- vendored verbatim from nayuki/QR-Code-generator@${COMMIT}; see THIRD_PARTY_NOTICES.md\n`;
const SUFFIX = "export { qrcodegen };\n";
const source = readFileSync(new URL("./vendor/qrcodegen.ts", import.meta.url), "utf8");
const notice = readFileSync(new URL("../../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");

function verify(text: string, attribution = notice): void {
  expect(text.startsWith(PREFIX)).toBe(true);
  expect(text.endsWith(SUFFIX)).toBe(true);
  const upstream = text.slice(PREFIX.length, -SUFFIX.length);
  expect(Buffer.byteLength(upstream)).toBe(41_022);
  expect(upstream.includes("\r")).toBe(false);
  const declarations = [...attribution.matchAll(/^SHA-256: ([a-f0-9]{64})$/gmu)];
  expect(declarations).toHaveLength(1);
  expect(declarations[0]![1]).toBe(SHA256);
  expect(createHash("sha256").update(upstream).digest("hex")).toBe(SHA256);
}

test("ships exact upstream bytes between the sole provenance and export lines", () => {
  verify(source);
});

test("ships the pinned source URL, commit and MIT permission notice with the package", () => {
  expect(notice).toContain(
    `https://github.com/nayuki/QR-Code-generator/blob/${COMMIT}/typescript-javascript/qrcodegen.ts`,
  );
  expect(notice).toContain("Copyright (c) Project Nayuki. (MIT License)");
  expect(notice).toContain("Permission is hereby granted, free of charge");
  expect(notice).toContain('The Software is provided "as is"');
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  expect(manifest.files).toContain("THIRD_PARTY_NOTICES.md");
});

test.each([
  { name: "one byte", mutate: (text: string) => text.replace("dataCodewords", "dataCodewordZ") },
  { name: "reformat", mutate: (text: string) => text.replaceAll("\t", "  ") },
  { name: "first line", mutate: (text: string) => text.replace("@ts-nocheck", "@ts-check") },
  { name: "last line", mutate: (text: string) => text.slice(0, -1) },
  { name: "line endings", mutate: (text: string) => text.replaceAll("\n", "\r\n") },
])("rejects a $name mutation", ({ mutate }) => {
  const changed = mutate(source);
  expect(changed !== source).toBe(true);
  expect(() => verify(changed)).toThrow();
});

test("changing the notice hash together with upstream bytes cannot change the pinned trust anchor", () => {
  const changed = source.replace("dataCodewords", "dataCodewordZ");
  const hash = createHash("sha256")
    .update(changed.slice(PREFIX.length, -SUFFIX.length))
    .digest("hex");
  expect(() => verify(changed, notice.replace(SHA256, hash))).toThrow();
});
