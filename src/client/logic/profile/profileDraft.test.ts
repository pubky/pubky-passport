import { describe, expect, it } from "vitest";
import { draftFromProfile, profileFromDraft } from "./profileDraft";

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
});
