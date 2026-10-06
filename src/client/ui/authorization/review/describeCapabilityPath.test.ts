import { describe, expect, it } from "vitest";

import { describeCapabilityPath, isOwnPublicFolder } from "./describeCapabilityPath";

describe("describeCapabilityPath", () => {
  it.each([
    ["/", "All your data"],
    ["/pub/", "All your public data"],
    ["/priv/", "All your private data"],
    ["/pub", "All your public data"],
    ["/priv", "All your private data"],
    ["/p", "All your data"],
    ["/pub/pubky.app/profile.json", "Your public profile"],
    ["/pub/pubky.app/follows/", "Who you follow"],
    ["/pub/pubky.app/posts/", "Your posts"],
    ["/pub/pubky.app/files/", "Your files"],
    ["/pub/pubky.app/blobs/", "Your file contents"],
    ["/pub/pubky.app/mutes/", "Who you mute"],
  ])("names the known folder %s", (path, title) => {
    expect(describeCapabilityPath(path)).toEqual({ text: title });
  });

  it("says when a path reaches only part of a known folder", () => {
    expect(describeCapabilityPath("/pub/pubky.app/posts/0034A0X7NJ52A").text).toBe(
      "Some of your posts",
    );
    expect(describeCapabilityPath("/pub/pubky.app/follows/abc/").text).toBe("Some of your follows");
    expect(describeCapabilityPath("/pub/pubky.app/last_read").text).toBe(
      "Part of your public Pubky social data",
    );
    // A look-alike folder name is not the folder.
    expect(describeCapabilityPath("/pub/pubky.app/postsx/").text).toBe(
      "Part of your public Pubky social data",
    );
  });

  const PUBLIC_SOCIAL = "Profile, posts, tags and follows";
  const PRIVATE_SOCIAL = "Drafts, bookmarks and mutes";
  const LOCKS = "Private content you share only with paying or approved people";
  it.each([
    ["/pub/pubky.app/", "Your public Pubky social data", PUBLIC_SOCIAL],
    ["/pub/social/", "Your public Pubky social data", PUBLIC_SOCIAL],
    ["/pub/social/v1/posts/", "Part of your public Pubky social data", PUBLIC_SOCIAL],
    ["/priv/social/", "Your private Pubky social data", PRIVATE_SOCIAL],
    ["/priv/social/v1/", "Part of your private Pubky social data", PRIVATE_SOCIAL],
    // Locks is its own product: never social data, never its raw folder name.
    ["/priv/app.locks/", "Your Locks content", LOCKS],
    ["/priv/app.locks/content/", "Part of your Locks content", LOCKS],
  ])("names the known namespace %s by what keeps it", (path, text, description) => {
    // The same title whatever the requesting app's host, its own included.
    for (const host of [undefined, "pubky.app", "app.locks", "social"])
      expect(describeCapabilityPath(path, host)).toEqual({ text, description });
  });

  it.each([
    ["/priv/app.lockss/", "An app's private data", "app.lockss"],
    ["/priv/socials/", "An app's private data", "socials"],
    ["/pub/social.example/", "An app's data", "social.example"],
  ])("keeps the generic copy for an unknown namespace %s", (path, text, folder) => {
    expect(describeCapabilityPath(path)).toEqual({ text, folder });
  });

  it("tells the requesting app's own folder from the folders other apps keep", () => {
    const host = "acme-notes.example";
    expect(describeCapabilityPath("/pub/acme-notes.example/", host)).toEqual({
      text: "This app's own data",
    });
    expect(describeCapabilityPath("/priv/acme-notes.example/keys/", host)).toEqual({
      text: "Some of this app's own private data",
    });
    expect(describeCapabilityPath("/pub/inbox.acme.example/", host)).toEqual({
      text: "Another app's data",
      folder: "inbox.acme.example",
    });
    expect(describeCapabilityPath("/priv/inbox.acme.example/drafts/", host)).toEqual({
      text: "Some of another app's private data",
      folder: "inbox.acme.example",
    });
    // A folder that only starts with the host is another app's.
    expect(describeCapabilityPath("/pub/acme-notes.example.evil/", host).folder).toBe(
      "acme-notes.example.evil",
    );
  });

  it("claims no folder as the app's own when the request names no website", () => {
    expect(describeCapabilityPath("/pub/acme-notes.example/")).toEqual({
      text: "An app's data",
      folder: "acme-notes.example",
    });
    expect(describeCapabilityPath("/priv/acme-notes.example/keys/")).toEqual({
      text: "Some of an app's private data",
      folder: "acme-notes.example",
    });
  });

  it("keeps a folder name out of the sentence, whatever it spells", () => {
    // Spaces and right-to-left letters stay in `folder`, which is shown isolated and quoted.
    const name = "your data \u05D0\u05D1 approved";
    expect(describeCapabilityPath(`/pub/${name}/notes/`, "acme.example")).toEqual({
      text: "Some of another app's data",
      folder: name,
    });
  });

  it("calls a file at the top of either side a file, and anything else other data", () => {
    expect(describeCapabilityPath("/pub/notes.txt").text).toBe("A public file");
    expect(describeCapabilityPath("/priv/notes.txt").text).toBe("A private file");
    expect(describeCapabilityPath("/elsewhere/").text).toBe("Other data");
  });
});

describe("isOwnPublicFolder", () => {
  it("is true only inside /pub/<callbackHost>/", () => {
    expect(isOwnPublicFolder("/pub/acme.example/", "acme.example")).toBe(true);
    expect(isOwnPublicFolder("/pub/acme.example/notes/", "acme.example")).toBe(true);
    expect(isOwnPublicFolder("/priv/acme.example/", "acme.example")).toBe(false);
    expect(isOwnPublicFolder("/pub/acme.example.evil/", "acme.example")).toBe(false);
    expect(isOwnPublicFolder("/pub/pubky.app/", "acme.example")).toBe(false);
    expect(isOwnPublicFolder("/pub/acme.example/", undefined)).toBe(false);
  });
});
