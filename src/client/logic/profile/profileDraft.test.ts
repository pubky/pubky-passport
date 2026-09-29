import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import {
  draftFromProfile,
  linkUrlLength,
  nextLinkId,
  profileDraftChanged,
  profileFromDraft,
  profileTextLength,
  validateProfileDraft,
  type ProfileDraft,
} from "./profileDraft";
import { buildProfilePublication } from "./ProfileSpecsAdapter";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";

function draft(changes: Partial<ProfileDraft> = {}): ProfileDraft {
  return { ...draftFromProfile(undefined, "Satoshi"), ...changes };
}
const link = (id: number, title: string, url: string) => ({ id, title, url, fixedTitle: false });

describe("profile drafts", () => {
  it("starts an empty profile with the suggested name and the two standard links", () => {
    expect(draftFromProfile(undefined, "Google name")).toEqual({
      name: "Google name",
      bio: "",
      links: [
        { id: 0, title: "Website", url: "", fixedTitle: true },
        { id: 1, title: "X (Twitter)", url: "", fixedTitle: true },
      ],
      image: null,
      status: null,
    });
  });

  it("keeps published fields and only standard link titles fixed", () => {
    const draft = draftFromProfile(
      {
        name: "Satoshi",
        bio: "Bitcoin",
        image: "pubky://key/pub/pubky.app/files/FILE",
        status: "busy",
        links: [
          { title: "Website", url: "https://bitcoin.org/" },
          { title: "Projects", url: "https://projects.example/" },
        ],
      },
      "Ignored",
    );
    expect(draft.name).toBe("Satoshi");
    expect(draft.links.map((link) => link.fixedTitle)).toEqual([true, false]);
    expect(draft.image).toBe("pubky://key/pub/pubky.app/files/FILE");
    expect(draft.status).toBe("busy");
  });

  it("drops empty links, trims URLs and expands a bare X handle", () => {
    const draft = draftFromProfile(undefined, "Satoshi");
    draft.links[0]!.url = "   ";
    draft.links[1]!.url = " @satoshi ";
    draft.links.push({
      id: 2,
      title: "X (Twitter)",
      url: "https://x.com/other",
      fixedTitle: false,
    });
    draft.links.push({ id: 3, title: "Blog", url: " @blog ", fixedTitle: false });
    expect(profileFromDraft(draft)).toEqual({
      name: "Satoshi",
      bio: null,
      image: null,
      status: null,
      links: [
        { title: "X (Twitter)", url: "https://x.com/satoshi" },
        { title: "X (Twitter)", url: "https://x.com/other" },
        { title: "Blog", url: "@blog" },
      ],
    });
  });

  it("numbers an added link after every link the draft has, published ones first", () => {
    expect(nextLinkId(draft())).toBe(5);
    // Kept edits can already hold added links; a new one must not reuse their ids.
    expect(
      nextLinkId(draft({ links: [link(0, "Website", ""), link(5, "", ""), link(7, "", "")] })),
    ).toBe(8);
  });

  it("counts text as the specification does: trimmed, in Unicode scalar values", () => {
    expect(profileTextLength("  Al  ")).toBe(2);
    expect(profileTextLength("🔥".repeat(50))).toBe(50);
  });
});

describe("profile draft changes", () => {
  it("counts only what saving would publish", () => {
    const saved = draft({ bio: "Bitcoin", image: "pubky://key/pub/pubky.app/files/FILE" });

    expect(profileDraftChanged({ ...saved }, saved)).toBe(false);
    // An empty link row and spaces around an address publish nothing new.
    expect(profileDraftChanged({ ...saved, links: [...saved.links, link(2, "", "")] }, saved)).toBe(
      false,
    );
    expect(
      profileDraftChanged(
        { ...saved, links: saved.links.map((item) => ({ ...item, url: "  " })) },
        saved,
      ),
    ).toBe(false);

    expect(profileDraftChanged({ ...saved, name: "Satoshi Nakamoto" }, saved)).toBe(true);
    expect(profileDraftChanged({ ...saved, bio: "" }, saved)).toBe(true);
    expect(profileDraftChanged({ ...saved, image: null }, saved)).toBe(true);
    expect(
      profileDraftChanged(
        { ...saved, links: [...saved.links, link(2, "Blog", "https://b.example")] },
        saved,
      ),
    ).toBe(true);
  });
});

describe("profile draft validation", () => {
  it("accepts a draft within every limit", () => {
    expect(
      validateProfileDraft(
        draft({
          name: "🔥".repeat(50),
          bio: `${"b".repeat(160)}   `,
          links: [
            { id: 0, title: "Website", url: "https://bitcoin.org", fixedTitle: true },
            { id: 1, title: "X (Twitter)", url: "@satoshi", fixedTitle: true },
            link(2, "t".repeat(100), `https://example.com/${"p".repeat(280)}`),
            // Without a URL a link is left out, so its title is not checked.
            link(3, "", "  "),
          ],
        }),
      ),
    ).toEqual({});
  });

  it("names each field that would be refused, in the order the form shows them", () => {
    const errors = validateProfileDraft(
      draft({
        name: " Al ",
        bio: "b".repeat(161),
        links: [
          { id: 0, title: "Website", url: "my website", fixedTitle: true },
          { id: 1, title: "X (Twitter)", url: "@satoshi nakamoto", fixedTitle: true },
          link(4, "  ", "https://github.com/satoshi"),
          link(2, "t".repeat(101), `https://example.com/${"a".repeat(278)} b`),
        ],
      }),
    );
    expect(errors).toEqual({
      name: "name_length",
      bio: "bio_too_long",
      "link-0-url": "link_url_invalid",
      "link-1-url": "link_url_invalid",
      "link-4-title": "link_title_missing",
      "link-2-title": "link_title_too_long",
      // 300 characters as typed, but the stored address encodes the space.
      "link-2-url": "link_url_too_long",
    });
    expect(Object.keys(errors)).toEqual([
      "name",
      "bio",
      "link-0-url",
      "link-1-url",
      "link-4-title",
      "link-2-title",
      "link-2-url",
    ]);
  });

  it.each([
    // The specs WASM accepts all of these; the first two are read as schemes and would be
    // published as broken links. Security invariant 9 asks for a web address without credentials.
    "www.example.com:8080",
    "localhost:3000",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://satoshi:secret@example.com",
    "https://satoshi@example.com",
  ])("refuses %s, which is not a web address without credentials", (url) => {
    expect(validateProfileDraft(draft({ links: [link(2, "Site", url)] }))).toEqual({
      "link-2-url": "link_url_invalid",
    });
  });

  it("measures an address as typed and as stored", () => {
    expect(linkUrlLength(link(2, "Site", " https://example.com/a "))).toEqual({
      typed: 21,
      stored: 21,
    });
    expect(linkUrlLength(link(2, "Site", "https://example.com/a b"))).toEqual({
      typed: 23,
      stored: 25,
    });
    expect(linkUrlLength(link(2, "Site", "localhost:3000"))).toBeNull();
  });

  it("refuses an empty or overlong name", () => {
    expect(validateProfileDraft(draft({ name: "   " }))).toEqual({ name: "name_length" });
    expect(validateProfileDraft(draft({ name: "n".repeat(51) }))).toEqual({ name: "name_length" });
  });

  it.each<[string, Partial<ProfileDraft>]>([
    ["a valid draft", {}],
    ["a two-character name", { name: "Al" }],
    ["a padded three-character name", { name: " Ali " }],
    ["a 51-character name", { name: "n".repeat(51) }],
    ["a 160-emoji bio", { bio: "🔥".repeat(160) }],
    ["a 161-character bio", { bio: "b".repeat(161) }],
    ["a link without a title", { links: [link(2, " ", "https://example.com")] }],
    ["a 100-character title", { links: [link(2, "t".repeat(100), "https://example.com")] }],
    ["a 101-character title", { links: [link(2, "t".repeat(101), "https://example.com")] }],
    ["an address without a scheme", { links: [link(2, "Site", "example.com")] }],
    ["an address the URL parser completes", { links: [link(2, "Site", "https:example.com")] }],
    ["a plain http address", { links: [link(2, "Site", "http://example.com")] }],
    [
      "a 300-character address",
      { links: [link(2, "Site", `https://example.com/${"p".repeat(280)}`)] },
    ],
    [
      "an address that grows past 300 when stored",
      { links: [link(2, "Site", `https://example.com/${"a".repeat(278)} b`)] },
    ],
  ])("agrees with the specs WASM on %s", async (_, changes) => {
    const subject = draft(changes);
    const published = await buildProfilePublication(KEY, profileFromDraft(subject));
    expect(Object.keys(validateProfileDraft(subject)).length === 0).toBe(Result.isOk(published));
  });
});
