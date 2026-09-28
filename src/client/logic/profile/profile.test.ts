import { describe, expect, it } from "vitest";
import {
  grantsCapabilities,
  ownAvatarResource,
  PROFILE_CAPABILITIES,
  sniffImageType,
} from "./profile";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const OTHER = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";

describe("image signatures", () => {
  it.each([
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe1]],
    ["image/gif", [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]],
    ["image/gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ["image/webp", [0x52, 0x49, 0x46, 0x46, 0xc3, 0xa9, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]],
    ["image/webp", [0x52, 0x49, 0x46, 0x46, 0xe2, 0x80, 0x01, 0x00, 0x57, 0x45, 0x42, 0x50]],
  ])("recognises %s from its bytes", (type, bytes) => {
    expect(sniffImageType(new Uint8Array(bytes))).toBe(type);
  });

  it.each([
    ["SVG markup", [...new TextEncoder().encode("<svg onload='x'/>")]],
    [
      "a RIFF container that is not WebP",
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45],
    ],
    ["a truncated header", [0x89, 0x50]],
    ["an unknown GIF version", [0x47, 0x49, 0x46, 0x38, 0x38, 0x61]],
  ])("rejects %s", (_label, bytes) => {
    expect(sniffImageType(new Uint8Array(bytes))).toBeUndefined();
  });
});

describe("avatar addresses", () => {
  it("accepts only the owner's own pubky.app files and blobs", () => {
    expect(ownAvatarResource(KEY, `pubky://${KEY}/pub/pubky.app/files/0035RY7969180`)).toBe(
      "files",
    );
    expect(
      ownAvatarResource(KEY, `pubky://${KEY}/pub/pubky.app/blobs/PZBQ010FF079VVZPQG1RNFN6DR`),
    ).toBe("blobs");
    for (const address of [
      "https://tracker.example/avatar.png",
      `pubky://${OTHER}/pub/pubky.app/files/0035RY7969180`,
      `pubky://${KEY}/pub/other.app/files/0035RY7969180`,
      `pubky://${KEY}/pub/pubky.app/files/../blobs/X`,
      `pubky://${KEY}/pub/pubky.app/files/X?query`,
      `pubky://${KEY}/priv/pubky.app/files/X`,
    ])
      expect(ownAvatarResource(KEY, address)).toBeUndefined();
  });
});

describe("profile grant capabilities", () => {
  it("asks Ring only to write the profile document and avatar directories", () => {
    expect(PROFILE_CAPABILITIES).toEqual([
      "/pub/pubky.app/profile.json:w",
      "/pub/pubky.app/files/:w",
      "/pub/pubky.app/blobs/:w",
    ]);
  });

  it("accepts a grant that covers every requested scope and action", () => {
    expect(grantsCapabilities([...PROFILE_CAPABILITIES], PROFILE_CAPABILITIES)).toBe(true);
    expect(
      grantsCapabilities(
        ["/pub/pubky.app/blobs/:rw", "/pub/pubky.app/files/:w", "/pub/pubky.app/profile.json:rw"],
        PROFILE_CAPABILITIES,
      ),
    ).toBe(true);
    expect(
      grantsCapabilities(
        ["/pub/pubky.app/profile.json:r", "/pub/pubky.app/profile.json:w"],
        ["/pub/pubky.app/profile.json:rw"],
      ),
    ).toBe(true);
  });

  it.each([
    ["a missing scope", ["/pub/pubky.app/profile.json:w", "/pub/pubky.app/files/:w"]],
    [
      "a read-only scope",
      ["/pub/pubky.app/profile.json:r", "/pub/pubky.app/files/:w", "/pub/pubky.app/blobs/:w"],
    ],
    [
      "a different scope that only looks similar",
      ["/pub/pubky.app/profile.json/:w", "/pub/pubky.app/files:w", "/pub/pubky.app/blobs/:w"],
    ],
    ["malformed entries", ["/pub/pubky.app/profile.json:x", "files/:w", ":w"]],
  ])("rejects %s", (_label, granted) => {
    expect(grantsCapabilities(granted, PROFILE_CAPABILITIES)).toBe(false);
  });
});
