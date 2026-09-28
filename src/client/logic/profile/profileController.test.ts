import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileController } from "./ProfileController";
import { PROFILE_PATH, type ProfileWrite } from "./profile";
import type { PubkyProfileTransport } from "../pubky/PubkySdkAdapter";
import { LocalStorageIdentityRepository } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import { MemoryStorage } from "@test-utils/MemoryStorage";
import { expectResultOk } from "@test-utils/resultAssertions";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const OTHER = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const PROFILE = {
  name: "Satoshi",
  bio: "A peer-to-peer electronic cash system.",
  links: [{ title: "Website", url: "https://bitcoin.org/" }],
  status: "busy",
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const FILE_ID = "0035RY7969180";
const BLOB_ID = "PZBQ010FF079VVZPQG1RNFN6DR";
type Transport = Pick<PubkyProfileTransport, "readImage" | "readJson" | "writeProfile">;
let repository: LocalStorageIdentityRepository;
let transport: { [Method in keyof Transport]: ReturnType<typeof vi.fn<Transport[Method]>> };
beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  repository = new LocalStorageIdentityRepository();
  expectResultOk(
    repository.save(
      { publicIdentity: { publicKeyZ32: KEY }, profileSetupRequired: true },
      { format: "pubky-secret-key", bytes: new Uint8Array(32).fill(1) },
    ),
  );
  transport = {
    readJson: vi.fn(async () => Result.ok<unknown>(PROFILE)),
    readImage: vi.fn(async () => Result.ok(new Blob([PNG], { type: "image/png" }))),
    writeProfile: vi.fn(async () => Result.ok()),
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function file(src: string) {
  return {
    name: "avatar.png",
    created_at: 1760000000000000,
    src,
    content_type: "image/png",
    size: 9,
  };
}
function writesOf(call = 0): readonly ProfileWrite[] {
  return transport.writeProfile.mock.calls[call]![2];
}

describe("public Pubky profiles", () => {
  it("loads the standard public document without reading any secret", async () => {
    const readSecret = vi.spyOn(repository, "read");
    const result = expectResultOk(await new ProfileController(repository, transport).load(KEY));
    expect(result?.profile).toEqual(PROFILE);
    expect(transport.readJson).toHaveBeenCalledWith(`pubky://${KEY}${PROFILE_PATH}`);
    expect(readSecret).not.toHaveBeenCalled();
  });

  it("keeps a missing profile, a failed read and an unreadable document apart", async () => {
    const controller = new ProfileController(repository, transport);
    transport.readJson
      .mockResolvedValueOnce(Result.ok(null))
      .mockResolvedValueOnce(Result.err({ code: "read_failed" }))
      .mockResolvedValueOnce(Result.err({ code: "read_timeout" }))
      .mockResolvedValueOnce(Result.ok({ name: "x" }))
      .mockResolvedValueOnce(Result.err({ code: "invalid_resource" }))
      .mockResolvedValueOnce(Result.err({ code: "resource_too_large" }));
    expect(expectResultOk(await controller.load(KEY))).toBeNull();
    for (const code of ["load_failed", "load_failed", "invalid_profile", "invalid_profile"])
      expect(await controller.load(KEY)).toMatchObject({ error: { code } });
    expect(await controller.load(KEY)).toMatchObject({ error: { code: "invalid_profile" } });
  });

  it("reads profiles the way pubky-app-specs sanitises them", async () => {
    transport.readJson.mockResolvedValueOnce(
      Result.ok({ name: " [DELETED] ", bio: null, image: null, links: null, status: null, x: 1 }),
    );
    expect(
      expectResultOk(await new ProfileController(repository, transport).load(KEY))?.profile,
    ).toEqual({ name: "anonymous" });
  });

  it("resolves the owner's file record to its blob", async () => {
    const image = `pubky://${KEY}/pub/pubky.app/files/${FILE_ID}`;
    const src = `pubky://${KEY}/pub/pubky.app/blobs/${BLOB_ID}`;
    transport.readJson
      .mockResolvedValueOnce(Result.ok({ ...PROFILE, image }))
      .mockResolvedValueOnce(Result.ok(file(src)));
    const avatar = expectResultOk(await new ProfileController(repository, transport).load(KEY));
    expect(avatar?.avatar?.type).toBe("image/png");
    expect(transport.readJson).toHaveBeenLastCalledWith(image);
    expect(transport.readImage).toHaveBeenCalledWith(src);
  });

  it.each([
    ["an HTTPS image", "https://tracker.example/avatar.png", undefined],
    ["another key's file", `pubky://${OTHER}/pub/pubky.app/files/${FILE_ID}`, undefined],
    ["a private path", `pubky://${KEY}/priv/avatar`, undefined],
    [
      "a file record pointing at another key's blob",
      `pubky://${KEY}/pub/pubky.app/files/${FILE_ID}`,
      file(`pubky://${OTHER}/pub/pubky.app/blobs/${BLOB_ID}`),
    ],
    [
      "a malformed file record",
      `pubky://${KEY}/pub/pubky.app/files/${FILE_ID}`,
      { src: `pubky://${KEY}/pub/pubky.app/blobs/${BLOB_ID}` },
    ],
  ])("never fetches or renders %s as an avatar", async (_label, image, record) => {
    transport.readJson.mockResolvedValueOnce(Result.ok({ ...PROFILE, image }));
    if (record) transport.readJson.mockResolvedValueOnce(Result.ok(record));
    const loaded = expectResultOk(await new ProfileController(repository, transport).load(KEY));
    expect(loaded?.profile.name).toBe("Satoshi");
    expect(loaded?.avatar).toBeUndefined();
    expect(transport.readImage).not.toHaveBeenCalled();
    expect(transport.readJson).toHaveBeenCalledTimes(record ? 2 : 1);
  });

  it("retains the profile when its avatar cannot be read in time", async () => {
    transport.readJson.mockResolvedValueOnce(
      Result.ok({ ...PROFILE, image: `pubky://${KEY}/pub/pubky.app/blobs/${BLOB_ID}` }),
    );
    transport.readImage.mockResolvedValueOnce(Result.err({ code: "read_timeout" }));
    const loaded = expectResultOk(await new ProfileController(repository, transport).load(KEY));
    expect(loaded?.profile.name).toBe("Satoshi");
    expect(loaded?.avatar).toBeUndefined();
  });

  it("completes setup only after publication and clears temporary secret bytes", async () => {
    const controller = new ProfileController(repository, transport);
    let finish!: () => void;
    transport.writeProfile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(Result.ok());
        }),
    );
    const saving = controller.save(KEY, { ...PROFILE, name: " Satoshi " });
    await vi.waitFor(() => expect(transport.writeProfile).toHaveBeenCalledOnce());
    expect(expectResultOk(repository.list()).identities[0]?.profileSetupRequired).toBe(true);
    const secret = transport.writeProfile.mock.calls[0]![1];
    expect(secret.some((byte) => byte !== 0)).toBe(true);
    expect(writesOf()).toEqual([
      { kind: "json", path: PROFILE_PATH, json: { ...PROFILE, name: "Satoshi" } },
    ]);
    finish();
    expect(expectResultOk(await saving)).toEqual({ ...PROFILE, name: "Satoshi" });
    expect(secret.every((byte) => byte === 0)).toBe(true);
    expect(expectResultOk(repository.list()).identities[0]?.profileSetupRequired).toBeUndefined();
    expect(expectResultOk(repository.read(KEY)).secretKey.bytes.some((byte) => byte !== 0)).toBe(
      true,
    );
  });

  it("publishes a re-encoded avatar as blob and file record before the profile", async () => {
    const encoded = new Uint8Array([...PNG, 1, 2, 3]);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 64, height: 64, close: vi.fn() })),
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          readonly width: number,
          readonly height: number,
        ) {}
        getContext() {
          return { drawImage: vi.fn() };
        }
        async convertToBlob() {
          return new Blob([encoded], { type: "image/png" });
        }
      },
    );
    const avatar = new File([PNG], "holiday-at-home.png", { type: "image/png" });
    const profile = expectResultOk(
      await new ProfileController(repository, transport).save(KEY, PROFILE, avatar),
    );
    const [blob, record, document] = writesOf();
    expect(blob).toMatchObject({ kind: "bytes", bytes: encoded });
    expect(blob?.path).toMatch(/^\/pub\/pubky\.app\/blobs\//);
    expect(record).toMatchObject({
      kind: "json",
      json: { name: "avatar.png", content_type: "image/png", size: encoded.byteLength },
    });
    expect(record?.path).toMatch(/^\/pub\/pubky\.app\/files\//);
    expect(document).toEqual({ kind: "json", path: PROFILE_PATH, json: profile });
    expect(profile.image).toBe(`pubky://${KEY}${record?.path}`);
  });

  it("rejects an unreadable avatar before reading keys or signing in", async () => {
    const read = vi.spyOn(repository, "read");
    const avatar = new File(["<svg/>"], "avatar.png", { type: "image/png" });
    expect(
      await new ProfileController(repository, transport).save(KEY, PROFILE, avatar),
    ).toMatchObject({ error: { code: "invalid_avatar" } });
    expect(read).not.toHaveBeenCalled();
    expect(transport.writeProfile).not.toHaveBeenCalled();
  });

  it("retains unfinished setup on a write failure, including after restore", async () => {
    transport.writeProfile.mockResolvedValue(Result.err({ code: "publish_failed" }));
    expect(await new ProfileController(repository, transport).save(KEY, PROFILE)).toMatchObject({
      error: { code: "save_failed" },
    });
    expectResultOk(
      repository.save(
        { publicIdentity: { publicKeyZ32: KEY } },
        { format: "pubky-secret-key", bytes: new Uint8Array(32).fill(1) },
      ),
    );
    expect(
      expectResultOk(new LocalStorageIdentityRepository().list()).identities[0]
        ?.profileSetupRequired,
    ).toBe(true);
  });

  it("reports mismatched key material as an unavailable identity", async () => {
    transport.writeProfile.mockResolvedValue(Result.err({ code: "identity_mismatch" }));
    expect(await new ProfileController(repository, transport).save(KEY, PROFILE)).toMatchObject({
      error: { code: "identity_unavailable" },
    });
  });

  it("rejects fields the specification refuses before reading keys or writing", async () => {
    const read = vi.spyOn(repository, "read");
    const controller = new ProfileController(repository, transport);
    for (const invalid of [
      { name: "x" },
      { name: "🔥".repeat(51) },
      { name: "Satoshi", bio: "x".repeat(161) },
      { name: "Satoshi", links: [{ title: "Website", url: "not a url" }] },
    ])
      expect(await controller.save(KEY, invalid)).toMatchObject({
        error: { code: "invalid_profile" },
      });
    expect(read).not.toHaveBeenCalled();
    expect(transport.writeProfile).not.toHaveBeenCalled();
    // Limits count Unicode scalar values, not UTF-16 code units.
    expectResultOk(await controller.save(KEY, { name: "🔥".repeat(50) }));
  });

  it("reports storage failure after publishing without claiming setup is finished", async () => {
    vi.spyOn(repository, "completeProfileSetup").mockReturnValue(
      Result.err({ code: "storage_unavailable" }),
    );
    expect(await new ProfileController(repository, transport).save(KEY, PROFILE)).toMatchObject({
      error: { code: "storage_failed" },
    });
    expect(expectResultOk(repository.list()).identities[0]?.profileSetupRequired).toBe(true);
  });

  it("reports a specs chunk that fails to load as retryable, not as invalid input", async () => {
    vi.resetModules();
    vi.doMock("pubky-app-specs", () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    });
    try {
      const { ProfileController: Isolated } = await import("./ProfileController");
      const read = vi.spyOn(repository, "read");
      const controller = new Isolated(repository, transport);
      expect(await controller.save(KEY, PROFILE)).toMatchObject({
        error: { code: "save_failed", cause: { code: "specs_unavailable" } },
      });
      expect(await controller.load(KEY)).toMatchObject({ error: { code: "load_failed" } });
      expect(read).not.toHaveBeenCalled();
      expect(transport.writeProfile).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("pubky-app-specs");
    }
  });
});
