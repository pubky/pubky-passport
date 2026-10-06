// @vitest-environment node
import { expect, test, vi } from "vitest";
import type { PubkyFacade } from "../config/PassportClientOptions.js";
import { readProfileDocument } from "./pubkyFlowAdapter.js";

const KEY = "y".repeat(52);
const CANARY = ["profile", "private", "sdk", "error"].join("-");
const bytes = (text: string) => new TextEncoder().encode(text);

function fixture(read: () => Promise<Response>, failure?: "getter" | "free") {
  let borrowed = false;
  const storage = {
    async get(address: string) {
      expect(this).toBe(storage);
      expect(address).toBe(`pubky${KEY}/pub/pubky.app/profile.json`);
      borrowed = true;
      try {
        return await read();
      } finally {
        borrowed = false;
      }
    },
    free: vi.fn(() => {
      expect(borrowed).toBe(false);
      if (failure === "free") throw new Error(CANARY);
    }),
  };
  const get = vi.fn(() => {
    if (failure === "getter") throw new Error(CANARY);
    return storage;
  });
  const facade = {
    get publicStorage() {
      return get();
    },
  } as unknown as PubkyFacade;
  return { facade, storage, get };
}

test("reads the public profile document and frees the storage wrapper", async () => {
  const h = fixture(async () => new Response(bytes('{"name":"Alice"}')));
  const result = await readProfileDocument(KEY, h.facade);
  expect(result.kind).toBe("found");
  expect(new TextDecoder().decode((result as { bytes: Uint8Array }).bytes)).toBe(
    '{"name":"Alice"}',
  );
  expect(h.get).toHaveBeenCalledOnce();
  expect(h.storage.free).toHaveBeenCalledOnce();
});

test.each([
  ["a 404 response", async () => new Response(null, { status: 404 })],
  [
    "a 404 RequestError",
    async () => {
      throw Object.assign(new Error(CANARY), { name: "RequestError", data: { statusCode: 404 } });
    },
  ],
])("%s means no profile", async (_name, read) => {
  const h = fixture(read);
  expect(await readProfileDocument(KEY, h.facade)).toEqual({ kind: "missing" });
  expect(h.storage.free).toHaveBeenCalledOnce();
});

test.each([
  ["a server error", async () => new Response("down", { status: 500 })],
  [
    "a network failure",
    async () => {
      throw Object.assign(new Error(CANARY), { name: "RequestError" });
    },
  ],
  ["a document over 64 KiB", async () => new Response(bytes("x".repeat(64 * 1024 + 1)))],
])("%s is an error without raw data", async (_name, read) => {
  const h = fixture(read);
  const result = await readProfileDocument(KEY, h.facade);
  expect(result).toEqual({ kind: "error" });
  expect(JSON.stringify(result)).not.toContain(CANARY);
  expect(h.storage.free).toHaveBeenCalledOnce();
});

test.each(["getter", "free"] as const)("a %s failure is contained", async (failure) => {
  const h = fixture(async () => new Response(bytes("{}")), failure);
  const result = await readProfileDocument(KEY, h.facade);
  expect(result.kind).toBe(failure === "getter" ? "error" : "found");
  expect(JSON.stringify(result)).not.toContain(CANARY);
});

test("a pending read keeps its storage wrapper alive until it settles", async () => {
  let settle!: (response: Response) => void;
  const h = fixture(() => new Promise<Response>((resolve) => (settle = resolve)));
  const result = readProfileDocument(KEY, h.facade);
  await Promise.resolve();
  expect(h.storage.free).not.toHaveBeenCalled();
  settle(new Response(null, { status: 404 }));
  expect(await result).toEqual({ kind: "missing" });
  expect(h.storage.free).toHaveBeenCalledOnce();
});
