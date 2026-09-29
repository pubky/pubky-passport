/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { Result } from "better-result";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import type { ProfileResult } from "@/client/logic/profile/ProfileController";
import type { LoadedProfile } from "@/client/logic/profile/profile";
import { useIdentityProfiles } from "./useIdentityProfiles";

const FIRST = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const load = vi.fn<(key: string) => Promise<ProfileResult<LoadedProfile | null>>>();
let objectUrls = 0;

function catalogOf(...keys: string[]): LocalIdentityCatalog {
  return {
    activePublicKeyZ32: keys[0] ?? null,
    identities: keys.map((publicKeyZ32) => ({ publicIdentity: { publicKeyZ32 } })),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return withPassportTestProviders(children, {
    createProfileController: () => ({
      load,
      save: async () => Result.err({ code: "save_failed" as const }),
      checkAvatar: async () => Result.ok(undefined),
    }),
  });
}

function names(result: { current: ReturnType<typeof useIdentityProfiles> }) {
  return result.current.catalog.identities.map((identity) => identity.profile?.name);
}

beforeEach(() => {
  objectUrls = 0;
  URL.createObjectURL = vi.fn(() => `blob:avatar-${(objectUrls += 1)}`);
  URL.revokeObjectURL = vi.fn();
  load.mockImplementation(async (key) =>
    Result.ok({ profile: { name: `Name ${key.slice(0, 4)}` }, avatar: new Blob(["png"]) }),
  );
});
afterEach(() => vi.clearAllMocks());

describe("useIdentityProfiles", () => {
  it("loads only the active identity until every identity is shown", async () => {
    const { result, rerender } = renderHook(({ catalog }) => useIdentityProfiles(catalog), {
      wrapper,
      initialProps: { catalog: catalogOf(FIRST, SECOND) },
    });
    await waitFor(() => expect(names(result)).toEqual(["Name 1aeh", undefined]));
    expect(load.mock.calls).toEqual([[FIRST]]);

    act(() => result.current.loadAll());
    await waitFor(() => expect(names(result)).toEqual(["Name 1aeh", "Name 5jsj"]));
    rerender({ catalog: catalogOf(FIRST, SECOND) });
    expect(load.mock.calls).toEqual([[FIRST], [SECOND]]);
  });

  it("reads nothing while loading the active identity is off, showing kept summaries", async () => {
    const catalog: LocalIdentityCatalog = {
      activePublicKeyZ32: FIRST,
      identities: [
        {
          publicIdentity: { publicKeyZ32: FIRST },
          profileSummary: { name: "Kept", avatar: "data:image/jpeg;base64,AAAA" },
        },
        { publicIdentity: { publicKeyZ32: SECOND } },
      ],
    };
    const { result, rerender } = renderHook(
      ({ loadActive }) => useIdentityProfiles(catalog, { loadActive }),
      { wrapper, initialProps: { loadActive: false } },
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(load).not.toHaveBeenCalled();
    expect(names(result)).toEqual(["Kept", undefined]);
    expect(result.current.catalog.identities[0]?.avatarUrl).toBe("data:image/jpeg;base64,AAAA");

    // Once an identity is chosen, only its profile is read, and the read replaces the summary.
    rerender({ loadActive: true });
    await waitFor(() => expect(names(result)).toEqual(["Name 1aeh", undefined]));
    expect(result.current.catalog.identities[0]?.avatarUrl).toBe("blob:avatar-1");
    expect(load.mock.calls).toEqual([[FIRST]]);
  });

  it("loads a newly selected identity without reloading the others", async () => {
    const { result, rerender } = renderHook(({ catalog }) => useIdentityProfiles(catalog), {
      wrapper,
      initialProps: { catalog: catalogOf(FIRST, SECOND) },
    });
    await waitFor(() => expect(names(result)[0]).toBe("Name 1aeh"));

    rerender({ catalog: catalogOf(SECOND, FIRST) });
    await waitFor(() => expect(names(result)).toEqual(["Name 5jsj", "Name 1aeh"]));
    expect(load.mock.calls).toEqual([[FIRST], [SECOND]]);
  });

  it("refetches only the identity that published, keeping other loads in flight", async () => {
    const resolvers = new Map<string, () => void>();
    load.mockImplementation(
      (key) =>
        new Promise((resolve) =>
          resolvers.set(key, () =>
            resolve(Result.ok({ profile: { name: `Read ${key.slice(0, 4)}` } })),
          ),
        ),
    );
    const { result } = renderHook(({ catalog }) => useIdentityProfiles(catalog), {
      wrapper,
      initialProps: { catalog: catalogOf(FIRST, SECOND) },
    });
    act(() => result.current.loadAll());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    const staleSecond = resolvers.get(SECOND)!;

    act(() => result.current.published(SECOND, { name: "Published" }));
    expect(names(result)).toEqual([undefined, "Published"]);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(load).toHaveBeenLastCalledWith(SECOND);
    await act(async () => {
      resolvers.get(FIRST)!();
      staleSecond();
    });
    // The first identity's load was not restarted; the superseded read is discarded.
    expect(names(result)).toEqual(["Read 1aeh", "Published"]);
    await act(async () => resolvers.get(SECOND)!());
    expect(names(result)).toEqual(["Read 1aeh", "Read 5jsj"]);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("keeps a published profile when reading it back fails", async () => {
    const { result } = renderHook(({ catalog }) => useIdentityProfiles(catalog), {
      wrapper,
      initialProps: { catalog: catalogOf(FIRST) },
    });
    await waitFor(() => expect(names(result)).toEqual(["Name 1aeh"]));
    load.mockResolvedValueOnce(Result.err({ code: "load_failed" }));
    act(() => result.current.published(FIRST, { name: "Published" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(names(result)).toEqual(["Published"]);
  });

  it("revokes avatar URLs for identities that leave the catalog, and all on unmount", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ catalog }) => useIdentityProfiles(catalog),
      { wrapper, initialProps: { catalog: catalogOf(FIRST, SECOND) } },
    );
    act(() => result.current.loadAll());
    await waitFor(() =>
      expect(result.current.catalog.identities.map((identity) => identity.avatarUrl)).toEqual(
        expect.arrayContaining(["blob:avatar-1", "blob:avatar-2"]),
      ),
    );
    const secondUrl = result.current.catalog.identities[1]?.avatarUrl;
    const firstUrl = result.current.catalog.identities[0]?.avatarUrl;

    rerender({ catalog: catalogOf(FIRST) });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(secondUrl);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(firstUrl);
    expect(result.current.catalog.identities).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(2);

    // Re-adding the identity loads it afresh rather than reusing the revoked URL.
    rerender({ catalog: catalogOf(FIRST, SECOND) });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(result.current.catalog.identities[1]?.avatarUrl).toBe("blob:avatar-3"),
    );

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:avatar-3");
  });
});
