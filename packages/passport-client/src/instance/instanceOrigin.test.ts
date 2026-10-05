// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { validateInstanceOrigin } from "./instanceOrigin.js";

const vectors: { input: string; options?: { allowLoopback?: boolean }; expected: string }[] =
  JSON.parse(
    readFileSync(new URL("../../test-vectors/instance-origin.json", import.meta.url), "utf8"),
  );

test("checks exactly 76 canonical vectors", () => {
  expect(vectors).toHaveLength(76);
});
test.each(vectors)("canonical origin vector %#", ({ input, options, expected }) => {
  expect(validateInstanceOrigin(input, options)).toEqual(
    expected.startsWith("http") ? { ok: true, origin: expected } : { ok: false, detail: expected },
  );
});
test.each([
  ["http://user@localhost/x", "insecure_scheme"],
  ["https://user@localhost/x", "credentials_not_allowed"],
  ["https://localhost/x", "local_or_ip_not_allowed"],
  ["https://host.example./x", "invalid_url"],
  ["https://pass\u0085port.example", "invalid_url"],
  ["https://passport.example/\u0085", "invalid_url"],
  ["https://pass\u00a0port.example", "invalid_url"],
  ["https://pass\u0000port.example", "invalid_url"],
  ["https://host.example?", "path_not_allowed"],
  ["https://host.example/path/..", "ok"],
])("returns the first failing rule for %s", (input, detail) => {
  const result = validateInstanceOrigin(input);
  expect(detail === "ok" ? result.ok : result).toEqual(
    detail === "ok" ? true : { ok: false, detail },
  );
});
test("rejects non-string input from JavaScript without throwing", () => {
  expect(validateInstanceOrigin(null as never)).toEqual({ ok: false, detail: "invalid_url" });
  expect(validateInstanceOrigin("passport.example", null as never)).toEqual({
    ok: true,
    origin: "https://passport.example",
  });
});
