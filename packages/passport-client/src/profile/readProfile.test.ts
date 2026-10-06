// @vitest-environment node
import { expect, test } from "vitest";
import type { PubkyFacade } from "../config/PassportClientOptions.js";
import { readProfile } from "./readProfile.js";
import { validateProfile } from "./validateProfile.js";

const KEY = "y".repeat(52);
const bytes = (text: string) => new TextEncoder().encode(text);
const facade = (response: () => Promise<Response>) =>
  ({
    get publicStorage() {
      return { get: response, free() {} };
    },
  }) as unknown as PubkyFacade;

test("returns the profile as pubky-app-specs sanitises it, frozen", async () => {
  const profile = await validateProfile(
    bytes(
      JSON.stringify({
        name: "  Alice  ",
        bio: "Hi",
        links: [{ title: "Site", url: "https://alice.example" }],
        extra: "dropped",
      }),
    ),
  );
  expect(profile).toEqual({
    name: "Alice",
    bio: "Hi",
    links: [{ title: "Site", url: "https://alice.example/" }],
  });
  expect(Object.isFrozen(profile)).toBe(true);
  expect(Object.isFrozen(profile!.links![0])).toBe(true);
});

test.each([
  ["an empty name", JSON.stringify({ name: "" })],
  ["a string", JSON.stringify("Alice")],
  ["broken JSON", "{"],
  ["invalid UTF-8", "￿"],
])("%s is not a profile", async (_name, text) => {
  const input = text === "￿" ? new Uint8Array([0xff, 0xfe]) : bytes(text);
  expect(await validateProfile(input)).toBeUndefined();
});

test("reads and validates a profile", async () => {
  const read = await readProfile(
    KEY,
    facade(async () => new Response(bytes('{"name":"Alice"}'))),
  );
  expect(read).toEqual({ kind: "found", profile: { name: "Alice" } });
});

test("an invalid document counts as no profile", async () => {
  const read = await readProfile(
    KEY,
    facade(async () => new Response(bytes('{"name":""}'))),
  );
  expect(read).toEqual({ kind: "missing" });
});

test("a missing document and a failed read pass through", async () => {
  expect(
    await readProfile(
      KEY,
      facade(async () => new Response(null, { status: 404 })),
    ),
  ).toEqual({ kind: "missing" });
  expect(
    await readProfile(
      KEY,
      facade(async () => new Response("", { status: 503 })),
    ),
  ).toEqual({
    kind: "error",
  });
});
