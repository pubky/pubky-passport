import { Result } from "better-result";
import { expect, it, vi } from "vitest";
import { RingProfileEditor } from "./RingProfileEditor";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";

it("reads public profiles directly and publishes only through the Ring grant", async () => {
  const load = vi.fn(async () => Result.ok(null));
  const save = vi.fn(async () => Result.ok({ name: "Satoshi" }));
  const editor = new RingProfileEditor({ load }, { save });
  const avatar = new File(["png"], "avatar.png", { type: "image/png" });
  expect(await editor.load(KEY)).toEqual(Result.ok(null));
  expect(await editor.save(KEY, { name: "Satoshi" }, avatar)).toEqual(
    Result.ok({ name: "Satoshi" }),
  );
  expect(load).toHaveBeenCalledWith(KEY);
  expect(save).toHaveBeenCalledWith(KEY, { name: "Satoshi" }, avatar);
});
