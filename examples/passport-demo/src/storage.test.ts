import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "@synonymdev/pubky";
import { deleteFile, listFiles, saveFile } from "./storage";

const parse = vi.hoisted(() => vi.fn());
vi.mock("@synonymdev/pubky", () => ({ PubkyResource: { parse } }));

beforeEach(() => vi.resetAllMocks());

it("frees list, parsed resource and read handles", async () => {
  const resource = { path: "/pub/template/files/a.json", free: vi.fn() };
  parse.mockReturnValue(resource);
  const storage = {
    list: vi.fn().mockResolvedValue(["pubky-user/pub/template/files/a.json"]),
    getJson: vi.fn().mockResolvedValue({ title: "Hello" }),
    free: vi.fn(),
  };
  expect(await listFiles({ storage } as unknown as Session)).toEqual([
    { id: "a", title: "Hello", body: "", updatedAt: "" },
  ]);
  expect(resource.free).toHaveBeenCalledOnce();
  expect(storage.free).toHaveBeenCalledTimes(2);
});

it.each(["list", "getJson", "putJson", "delete"])(
  "frees the storage handle when %s fails",
  async (operation) => {
    const error = new Error("offline");
    parse.mockReturnValue({ path: "/pub/template/files/a.json", free: vi.fn() });
    const storage = {
      list: vi.fn().mockResolvedValue(["pubky-user/pub/template/files/a.json"]),
      getJson: vi.fn(),
      putJson: vi.fn(),
      delete: vi.fn(),
      free: vi.fn(),
    };
    storage[operation as "list" | "getJson" | "putJson" | "delete"].mockRejectedValue(error);
    const session = { storage } as unknown as Session;
    const result =
      operation === "putJson"
        ? saveFile(session, { title: "title", body: "body" })
        : operation === "delete"
          ? deleteFile(session, "a")
          : listFiles(session);
    await expect(result).rejects.toBe(error);
    expect(storage.free).toHaveBeenCalledTimes(operation === "getJson" ? 2 : 1);
  },
);
