import { Result } from "better-result";
import { expect, it, vi } from "vitest";
import { RingProfileEditor } from "./RingProfileEditor";
import { draftFromProfile } from "./profileDraft";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const OTHER_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";

function ringEditor() {
  const load = vi.fn(async () => Result.ok(null));
  const checkAvatar = vi.fn(async () => Result.err({ code: "invalid_avatar" as const }));
  const save = vi.fn(async () => Result.ok({ name: "Satoshi" }));
  return {
    editor: new RingProfileEditor({ load, checkAvatar }, { save }),
    load,
    checkAvatar,
    save,
  };
}

it("reads public profiles directly and publishes only through the Ring grant", async () => {
  const { editor, load, checkAvatar, save } = ringEditor();
  const avatar = new File(["png"], "avatar.png", { type: "image/png" });
  expect(await editor.load(KEY)).toEqual(Result.ok(null));
  // A chosen avatar is checked like any other, without the grant.
  expect(await editor.checkAvatar(avatar)).toMatchObject({ error: { code: "invalid_avatar" } });
  expect(await editor.save(KEY, { name: "Satoshi" }, avatar)).toEqual(
    Result.ok({ name: "Satoshi" }),
  );
  expect(load).toHaveBeenCalledWith(KEY);
  expect(checkAvatar).toHaveBeenCalledWith(avatar);
  expect(save).toHaveBeenCalledWith(KEY, { name: "Satoshi" }, avatar);
});

it("keeps an identity's unpublished edits while Ring reconnects, until they are dropped", () => {
  const { editor } = ringEditor();
  const edits = {
    draft: { ...draftFromProfile({ name: "Carol" }, ""), name: "Carol Danvers" },
    avatar: new File(["png"], "avatar.png", { type: "image/png" }),
  };
  expect(editor.keptEdits(KEY)).toBeUndefined();

  editor.keepEdits(KEY, edits);
  expect(editor.keptEdits(KEY)).toBe(edits);
  expect(editor.keptEdits(OTHER_KEY)).toBeUndefined();

  // Kept while that identity's editor or its connection is open, dropped once another view opens.
  editor.forgetEditsExcept(KEY);
  expect(editor.keptEdits(KEY)).toBe(edits);
  editor.forgetEditsExcept(undefined);
  expect(editor.keptEdits(KEY)).toBeUndefined();

  // Only one editor is open at a time: another identity's edits replace them.
  editor.keepEdits(KEY, edits);
  editor.keepEdits(OTHER_KEY, edits);
  expect(editor.keptEdits(KEY)).toBeUndefined();
  editor.forgetEditsExcept(KEY);
  expect(editor.keptEdits(OTHER_KEY)).toBeUndefined();
});
