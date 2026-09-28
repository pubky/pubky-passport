import { Client, Keypair, Pubky, PublicStorage, Signer, type Session } from "@synonymdev/pubky";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUEST_TIMEOUT_MS } from "@/libs/passportPolicy";
import { expectResultOk } from "@test-utils/resultAssertions";
import { PubkyProfileTransport, fetchHomeserver } from "./PubkySdkAdapter";
import { MAX_AVATAR_BYTES, PROFILE_PATH, type ProfileWrite } from "../profile/profile";

const SECRET = new Uint8Array(32).fill(1);
const keypair = Keypair.fromSecret(SECRET);
const key = keypair.publicKey;
const KEY = key.z32();
key.free();
keypair.free();
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0];
const BLOB = new Uint8Array(PNG);
const WRITES: ProfileWrite[] = [
  { kind: "bytes", path: "/pub/pubky.app/blobs/BLOB", bytes: BLOB },
  { kind: "json", path: "/pub/pubky.app/files/FILE", json: { name: "avatar.png" } },
  { kind: "json", path: PROFILE_PATH, json: { name: "Satoshi" } },
];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function session() {
  const putJson = vi.fn(async () => undefined);
  const putBytes = vi.fn(async () => undefined);
  const storage = { putJson, putBytes, free: vi.fn() };
  const signout = vi.fn(async () => undefined);
  const free = vi.fn();
  const signin = vi.spyOn(Signer.prototype, "signin").mockResolvedValue({
    storage,
    signout,
    free,
  } as unknown as Session);
  return { storage, signout, free, signin };
}

describe("profile SDK transport writes", () => {
  it("applies the writes in order with a session that exists only for this call", async () => {
    const { storage, signout, free, signin } = session();
    expectResultOk(await new PubkyProfileTransport().writeProfile(KEY, SECRET, WRITES));
    expect(signin).toHaveBeenCalledWith("passport.pubky.app");
    expect(storage.putBytes).toHaveBeenCalledWith("/pub/pubky.app/blobs/BLOB", BLOB);
    expect(storage.putJson.mock.calls).toEqual([
      ["/pub/pubky.app/files/FILE", { name: "avatar.png" }],
      [PROFILE_PATH, { name: "Satoshi" }],
    ]);
    expect(storage.putBytes.mock.invocationCallOrder[0]).toBeLessThan(
      storage.putJson.mock.invocationCallOrder[0]!,
    );
    // Signing out revokes the grant; every handle is released afterwards.
    expect(signout).toHaveBeenCalledOnce();
    expect(storage.free).toHaveBeenCalledOnce();
    expect(free).toHaveBeenCalledOnce();
  });

  it("stops at the first failed write and still revokes the session", async () => {
    const { storage, signout } = session();
    storage.putBytes.mockRejectedValue(new Error("offline"));
    expect(await new PubkyProfileTransport().writeProfile(KEY, SECRET, WRITES)).toMatchObject({
      error: { code: "publish_failed" },
    });
    expect(storage.putJson).not.toHaveBeenCalled();
    expect(signout).toHaveBeenCalledOnce();
  });

  it("reports a rejected session separately from other write failures", async () => {
    const { storage } = session();
    storage.putBytes.mockRejectedValue({ name: "RequestError", data: { statusCode: 401 } });
    expect(await new PubkyProfileTransport().writeProfile(KEY, SECRET, WRITES)).toMatchObject({
      error: { code: "publish_unauthorized" },
    });
  });

  it("rejects mismatched secret material before signing in or writing", async () => {
    const { storage, signin } = session();
    expect(
      await new PubkyProfileTransport().writeProfile(
        "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo",
        SECRET,
        WRITES,
      ),
    ).toMatchObject({ error: { code: "identity_mismatch" } });
    expect(signin).not.toHaveBeenCalled();
    expect(storage.putJson).not.toHaveBeenCalled();
  });

  it("reports a failed sign-in without writing", async () => {
    const { storage, signin, signout } = session();
    signin.mockRejectedValue(new Error("offline"));
    expect(await new PubkyProfileTransport().writeProfile(KEY, SECRET, WRITES)).toMatchObject({
      error: { code: "signin_failed" },
    });
    expect(storage.putBytes).not.toHaveBeenCalled();
    expect(signout).not.toHaveBeenCalled();
  });

  it("keeps a successful write successful when session signout fails", async () => {
    const { signout, free } = session();
    signout.mockRejectedValue(new Error("offline"));
    expectResultOk(await new PubkyProfileTransport().writeProfile(KEY, SECRET, WRITES));
    expect(free).toHaveBeenCalledOnce();
  });
});

describe("profile SDK transport reads", () => {
  const address = `pubky://${KEY}${PROFILE_PATH}`;
  const avatar = `pubky://${KEY}/pub/pubky.app/blobs/BLOB`;

  it("distinguishes a missing profile from a failed public read", async () => {
    vi.spyOn(PublicStorage.prototype, "get")
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce({ name: "RequestError", data: { statusCode: 404 } })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const transport = new PubkyProfileTransport();
    expect(expectResultOk(await transport.readJson(address))).toBeNull();
    expect(expectResultOk(await transport.readJson(address))).toBeNull();
    expect(await transport.readJson(address)).toMatchObject({ error: { code: "read_failed" } });
    expect(await transport.readJson(address)).toMatchObject({ error: { code: "read_failed" } });
  });

  it("reports oversized, malformed and empty documents as unreadable, not as failed reads", async () => {
    vi.spyOn(PublicStorage.prototype, "get")
      .mockResolvedValueOnce(new Response("x".repeat(64 * 1024 + 1)))
      .mockResolvedValueOnce(new Response("{not json"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "Satoshi" })));
    const transport = new PubkyProfileTransport();
    expect(await transport.readJson(address)).toMatchObject({
      error: { code: "resource_too_large" },
    });
    expect(await transport.readJson(address)).toMatchObject({
      error: { code: "invalid_resource" },
    });
    expect(await transport.readJson(address)).toMatchObject({
      error: { code: "invalid_resource" },
    });
    expect(expectResultOk(await transport.readJson(address))).toEqual({ name: "Satoshi" });
  });

  it("gives up on a stalled homeserver after the request deadline and cancels the body", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const cancel = vi.fn();
    vi.spyOn(PublicStorage.prototype, "get")
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
    const transport = new PubkyProfileTransport();
    const stalledResponse = transport.readJson(address);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await stalledResponse).toMatchObject({ error: { code: "read_timeout" } });
    const stalledBody = transport.readImage(avatar);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await stalledBody).toMatchObject({ error: { code: "read_timeout" } });
    expect(cancel).toHaveBeenCalled();
  });

  it.each([
    ["image/png", PNG],
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0, 0, 0x10]],
    ["image/gif", [...new TextEncoder().encode("GIF89a"), 1, 0]],
    // The RIFF size is binary; C3 A9 is a UTF-8 sequence that text decoding would merge.
    ["image/webp", [0x52, 0x49, 0x46, 0x46, 0xc3, 0xa9, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]],
  ])("identifies %s avatars by their signature", async (type, bytes) => {
    vi.spyOn(PublicStorage.prototype, "get").mockResolvedValueOnce(
      new Response(new Uint8Array(bytes), {
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    expect(expectResultOk(await new PubkyProfileTransport().readImage(avatar)).type).toBe(type);
  });

  it("rejects non-image, oversized and missing avatars", async () => {
    vi.spyOn(PublicStorage.prototype, "get")
      .mockResolvedValueOnce(new Response("<svg onload='bad()'/>"))
      .mockResolvedValueOnce(new Response(new Uint8Array(MAX_AVATAR_BYTES + 1)))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const transport = new PubkyProfileTransport();
    expect(await transport.readImage(avatar)).toMatchObject({
      error: { code: "invalid_resource" },
    });
    expect(await transport.readImage(avatar)).toMatchObject({
      error: { code: "resource_too_large" },
    });
    expect(await transport.readImage(avatar)).toMatchObject({ error: { code: "read_failed" } });
  });
});

it("reuses one public SDK client for homeserver requests", async () => {
  const client = vi.spyOn(Pubky.prototype, "client", "get");
  const fetch = vi
    .spyOn(Client.prototype, "fetch")
    .mockImplementation(async () => new Response(null, { status: 204 }));
  await fetchHomeserver(`https://${KEY}/signup_tokens/a`, {});
  await fetchHomeserver(`https://${KEY}/signup_tokens/b`, {});
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(client.mock.calls.length).toBeLessThanOrEqual(1);
});
