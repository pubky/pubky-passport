import { describe, expect, it } from "vitest";
import { expectResultOk } from "@test-utils/resultAssertions";
import {
  PROFILE_LIMITS,
  buildProfilePublication,
  checkLinkUrls,
  parseFileRecordSource,
  parseProfile,
} from "./ProfileSpecsAdapter";
import { PROFILE_PATH } from "./profile";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

describe("pubky-app-specs profile boundary", () => {
  it("exposes the pinned release's user limits", () => {
    expect(PROFILE_LIMITS).toEqual({
      nameMinLength: 3,
      nameMaxLength: 50,
      bioMaxLength: 160,
      linksMaxCount: 5,
      linkTitleMaxLength: 100,
      linkUrlMaxLength: 300,
    });
  });

  it("parses profiles with the specification's sanitisation and rejects invalid ones", async () => {
    expect(expectResultOk(await parseProfile({ name: " Satoshi ", bio: null, extra: 1 }))).toEqual({
      name: "Satoshi",
    });
    expect(expectResultOk(await parseProfile({ name: "[DELETED]" }))).toEqual({
      name: "anonymous",
    });
    for (const invalid of [{ name: "x" }, 5, null, { name: "Satoshi", image: "not a url" }])
      expect(await parseProfile(invalid)).toMatchObject({ error: { code: "invalid_profile" } });
  });

  it("judges link addresses as the profile validation does, whatever their scheme", async () => {
    expect(
      expectResultOk(
        await checkLinkUrls([
          " HTTPS://Example.com/a b ",
          `pubky://${KEY}/pub/pubky.app/profile.json`,
          "mailto:satoshi@example.com",
          "javascript:alert(1)",
          "example.com",
          `https://example.com/${"p".repeat(281)}`,
        ]),
      ),
    ).toEqual([
      { url: " HTTPS://Example.com/a b ", stored: "https://example.com/a%20b", accepted: true },
      {
        url: `pubky://${KEY}/pub/pubky.app/profile.json`,
        stored: `pubky://${KEY}/pub/pubky.app/profile.json`,
        accepted: true,
      },
      { url: "mailto:satoshi@example.com", stored: "mailto:satoshi@example.com", accepted: true },
      { url: "javascript:alert(1)", stored: "javascript:alert(1)", accepted: true },
      { url: "example.com", stored: "example.com", accepted: false },
      {
        url: `https://example.com/${"p".repeat(281)}`,
        stored: `https://example.com/${"p".repeat(281)}`,
        accepted: false,
      },
    ]);
    expect(expectResultOk(await checkLinkUrls([]))).toEqual([]);
  });

  it("reads the blob address from a valid file record only", async () => {
    const src = `pubky://${KEY}/pub/pubky.app/blobs/PZBQ010FF079VVZPQG1RNFN6DR`;
    expect(
      expectResultOk(
        await parseFileRecordSource({
          name: "avatar.png",
          created_at: 1760000000000000,
          src,
          content_type: "image/png",
          size: 9,
        }),
      ),
    ).toBe(src);
    expect(await parseFileRecordSource({ src })).toMatchObject({
      error: { code: "invalid_file_record" },
    });
  });

  it("builds a profile-only publication", async () => {
    const publication = expectResultOk(
      await buildProfilePublication(KEY, { name: " Satoshi ", bio: null, links: [] }),
    );
    expect(publication.profile).toEqual({ name: "Satoshi", links: [] });
    expect(publication.writes).toEqual([
      { kind: "json", path: PROFILE_PATH, json: { name: "Satoshi", links: [] } },
    ]);
  });

  it("orders the avatar blob and file record before the profile that points at them", async () => {
    const publication = expectResultOk(
      await buildProfilePublication(
        KEY,
        { name: "Satoshi", image: "https://old.example/avatar.png" },
        { bytes: PNG, contentType: "image/png", name: "avatar.png" },
      ),
    );
    const [blob, file, profile] = publication.writes;
    expect(blob).toEqual({
      kind: "bytes",
      path: expect.stringMatching(/^\/pub\/pubky\.app\/blobs\/[0-9A-Z]{26}$/),
      bytes: PNG,
    });
    expect(file).toMatchObject({
      kind: "json",
      path: expect.stringMatching(/^\/pub\/pubky\.app\/files\/[0-9A-Z]{13}$/),
      json: {
        name: "avatar.png",
        src: `pubky://${KEY}${blob?.path}`,
        content_type: "image/png",
        size: PNG.byteLength,
      },
    });
    expect(publication.profile.image).toBe(`pubky://${KEY}${file?.path}`);
    expect(profile).toEqual({ kind: "json", path: PROFILE_PATH, json: publication.profile });
  });

  it("rejects invalid profiles, avatars and identities", async () => {
    expect(await buildProfilePublication(KEY, { name: "x" })).toMatchObject({
      error: { code: "invalid_profile" },
    });
    expect(
      await buildProfilePublication(
        KEY,
        { name: "Satoshi" },
        { bytes: PNG, contentType: "image/heic", name: "avatar.heic" },
      ),
    ).toMatchObject({ error: { code: "invalid_avatar" } });
    expect(await buildProfilePublication(`pubky${KEY}`, { name: "Satoshi" })).toMatchObject({
      error: { code: "invalid_profile" },
    });
  });
});
