import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { expectResultOk } from "@test-utils/resultAssertions";
import {
  checkDraftLinks,
  draftFromProfile,
  linkUrlLength,
  nextLinkId,
  profileDraftChanged,
  profileFromDraft,
  profileTextLength,
  validateProfileDraft,
  type LinkUrlChecks,
  type ProfileDraft,
} from "./profileDraft";
import { PROFILE_PATH } from "./profile";
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

/** The specs' answers about `subject`'s link addresses, as a save asks for them. */
async function linksOf(subject: ProfileDraft): Promise<LinkUrlChecks> {
  return expectResultOk(await checkDraftLinks(subject));
}

/** How `subject` would be refused, with its addresses judged by the specs. */
async function validate(subject: ProfileDraft) {
  return validateProfileDraft(subject, await linksOf(subject));
}

describe("profile draft validation", () => {
  it("accepts a draft within every limit", async () => {
    expect(
      await validate(
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

  it("names each field that would be refused, in the order the form shows them", async () => {
    const errors = await validate(
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
    "https://example.com",
    "http://example.com",
    `pubky://${KEY}/pub/pubky.app/profile.json`,
    "mailto:satoshi@example.com",
    "https://satoshi@example.com",
    "localhost:3000",
    // Accepted by the specs, so a profile may carry them; Passport never makes them a link.
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
  ])("accepts %s, as the specs do", async (url) => {
    expect(await validate(draft({ links: [link(2, "Site", url)] }))).toEqual({});
  });

  it.each(["example.com", "my website", "https://exa mple.com", "http://"])(
    "refuses %s, which the specs do not take for a URL",
    async (url) => {
      expect(await validate(draft({ links: [link(2, "Site", url)] }))).toEqual({
        "link-2-url": "link_url_invalid",
      });
    },
  );

  it("measures an address as typed and as stored", async () => {
    const subject = draft({
      links: [
        link(2, "Site", " https://example.com/a "),
        link(3, "Site", "https://example.com/a b"),
      ],
    });
    const links = await linksOf(subject);
    expect(linkUrlLength(subject.links[0]!, links)).toEqual({ typed: 21, stored: 21 });
    expect(linkUrlLength(subject.links[1]!, links)).toEqual({ typed: 23, stored: 25 });
    // An address the specs were not asked about has no stored length.
    expect(linkUrlLength(link(4, "Site", "https://other.example"), links)).toBeNull();
  });

  it("keeps a published profile's links of every scheme unchanged when it is saved again", async () => {
    const profile = {
      name: "Satoshi",
      links: [
        { title: "Website", url: "https://bitcoin.org/" },
        { title: "Pubky", url: `pubky://${KEY}/pub/pubky.app/profile.json` },
        { title: "Email", url: "mailto:satoshi@example.com" },
        { title: "Lightning", url: "lightning:satoshi@example.com" },
      ],
    };
    const opened = draftFromProfile(profile, "Ignored");
    expect(await validate(opened)).toEqual({});
    const publication = expectResultOk(
      await buildProfilePublication(KEY, profileFromDraft(opened)),
    );
    expect(publication.profile.links).toEqual(profile.links);
    expect(publication.writes).toEqual([
      { kind: "json", path: PROFILE_PATH, json: { name: "Satoshi", links: profile.links } },
    ]);
  });

  it("refuses an empty or overlong name", async () => {
    expect(await validate(draft({ name: "   " }))).toEqual({ name: "name_length" });
    expect(await validate(draft({ name: "n".repeat(51) }))).toEqual({ name: "name_length" });
  });

  it("leaves an address the specs were not asked about to their check of the document", () => {
    expect(
      validateProfileDraft(draft({ links: [link(2, "Site", "my website")] }), new Map()),
    ).toEqual({});
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
    ["a pubky address", { links: [link(2, "Site", `pubky://${KEY}`)] }],
    ["a mailto address", { links: [link(2, "Site", "mailto:satoshi@example.com")] }],
    ["a javascript address", { links: [link(2, "Site", "javascript:alert(1)")] }],
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
    expect(Object.keys(await validate(subject)).length === 0).toBe(Result.isOk(published));
  });
});
