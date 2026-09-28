import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import type { ProfileResult } from "./ProfileController";
import { ProfileLoadQueue } from "./ProfileLoadQueue";
import type { LoadedProfile } from "./profile";

type Load = ProfileResult<LoadedProfile | null>;
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferredLoads() {
  const pending = new Map<string, ((result: Load) => void)[]>();
  const load = vi.fn(
    (key: string) =>
      new Promise<Load>((resolve) => {
        pending.set(key, [...(pending.get(key) ?? []), resolve]);
      }),
  );
  const finish = async (key: string, name = key, index = 0) => {
    pending.get(key)![index]!(Result.ok({ profile: { name } }));
    await settled();
  };
  return { load, finish, pending };
}

describe("profile load queue", () => {
  it("loads each requested key once with at most three reads in flight", async () => {
    const { load, finish } = deferredLoads();
    const loaded = vi.fn();
    const queue = new ProfileLoadQueue(load, loaded);
    queue.request(["a", "b", "c", "d"]);
    queue.request(["a", "b"]);
    expect(load.mock.calls.map(([key]) => key)).toEqual(["a", "b", "c"]);
    await finish("a");
    expect(load.mock.calls.map(([key]) => key)).toEqual(["a", "b", "c", "d"]);
    expect(loaded).toHaveBeenCalledWith("a", { profile: { name: "a" } });
  });

  it("refreshes one key without discarding the other loads in flight", async () => {
    const { load, finish } = deferredLoads();
    const loaded = vi.fn();
    const queue = new ProfileLoadQueue(load, loaded);
    queue.request(["a", "b"]);
    queue.refresh("b");
    await finish("a");
    await finish("b", "stale", 0);
    await finish("b", "fresh", 1);
    expect(load).toHaveBeenCalledTimes(3);
    expect(loaded.mock.calls).toEqual([
      ["a", { profile: { name: "a" } }],
      ["b", { profile: { name: "fresh" } }],
    ]);
  });

  it("drops results for forgotten keys and loads them afresh when requested again", async () => {
    const { load, finish } = deferredLoads();
    const loaded = vi.fn();
    const queue = new ProfileLoadQueue(load, loaded);
    queue.request(["a", "b"]);
    expect(queue.retain(new Set(["a"]))).toEqual(["b"]);
    await finish("b");
    expect(loaded).not.toHaveBeenCalled();
    queue.request(["a", "b"]);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("retries a failed load on the next request and ignores results after disposal", async () => {
    const load = vi
      .fn<(key: string) => Promise<Load>>()
      .mockResolvedValueOnce(Result.err({ code: "load_failed" }))
      .mockRejectedValueOnce(new Error("unexpected"))
      .mockResolvedValue(Result.ok(null));
    const loaded = vi.fn();
    const queue = new ProfileLoadQueue(load, loaded);
    queue.request(["a"]);
    await settled();
    queue.request(["a"]);
    await settled();
    expect(loaded).not.toHaveBeenCalled();
    queue.request(["a"]);
    await settled();
    expect(loaded).toHaveBeenCalledWith("a", null);
    queue.dispose();
    queue.refresh("a");
    expect(load).toHaveBeenCalledTimes(3);
  });
});
