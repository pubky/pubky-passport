/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "@test-utils/MemoryStorage";
import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import { PUBKY_SECRET_KEY_FORMAT } from "@/client/logic/pubky/pubkyIdentityKey";
import { LocalStorageIdentityRepository } from "./LocalStorageIdentityRepository";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const OTHER_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const RECORD = `pubky-passport/local-identities/v1/identity/${KEY}`;
const ACTIVE = "pubky-passport/local-identities/v1/active";
const GOOGLE = {
  googleSubject: "google-subject",
  email: "user@example.com",
  name: "User",
  pictureUrl: null,
};
const APPLE = { appleSubject: "apple-subject", email: "jane@example.com", name: null };

describe("LocalStorageIdentityRepository.linkProviderAccount", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function saveBrowserOnly(publicKeyZ32 = KEY): string {
    expectResultOk(
      new LocalStorageIdentityRepository().save(
        { publicIdentity: { publicKeyZ32 } },
        { bytes: new Uint8Array(32).fill(3), format: PUBKY_SECRET_KEY_FORMAT },
      ),
    );
    return localStorage.getItem(`pubky-passport/local-identities/v1/identity/${publicKeyZ32}`)!;
  }

  it("links Google to a browser-only identity and keeps its key and the active identity", () => {
    const before = JSON.parse(saveBrowserOnly()) as { secretKey: string };
    saveBrowserOnly(OTHER_KEY);
    const repository = new LocalStorageIdentityRepository();
    const changed = vi.fn();
    const unsubscribe = repository.subscribe(changed);

    expect(expectResultOk(repository.linkProviderAccount(KEY, { googleAccount: GOOGLE }))).toBe(
      "linked",
    );

    unsubscribe();
    expect(changed).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(RECORD)!)).toEqual({
      v: 1,
      publicKeyZ32: KEY,
      googleAccount: GOOGLE,
      secretKey: before.secretKey,
    });
    expect(localStorage.getItem(ACTIVE)).toBe(OTHER_KEY);
    const identities = expectResultOk(repository.list()).identities;
    expect(identities.find((identity) => identity.publicIdentity.publicKeyZ32 === KEY)).toEqual({
      publicIdentity: { publicKeyZ32: KEY },
      googleAccount: GOOGLE,
    });
  });

  it("links an Apple Account", () => {
    saveBrowserOnly();
    const repository = new LocalStorageIdentityRepository();

    expect(expectResultOk(repository.linkProviderAccount(KEY, { appleAccount: APPLE }))).toBe(
      "linked",
    );
    expect(expectResultOk(repository.read(KEY)).identity).toEqual({
      publicIdentity: { publicKeyZ32: KEY },
      appleAccount: APPLE,
    });
  });

  it("treats the same account as already linked and any other account as a conflict", () => {
    saveBrowserOnly();
    const repository = new LocalStorageIdentityRepository();
    expectResultOk(repository.linkProviderAccount(KEY, { googleAccount: GOOGLE }));
    const linked = localStorage.getItem(RECORD);

    expect(
      expectResultOk(
        repository.linkProviderAccount(KEY, { googleAccount: { ...GOOGLE, name: "Renamed" } }),
      ),
    ).toBe("already-linked");
    expectResultError(
      repository.linkProviderAccount(KEY, {
        googleAccount: { ...GOOGLE, googleSubject: "someone-else" },
      }),
      { code: "provider_conflict" },
    );
    expectResultError(repository.linkProviderAccount(KEY, { appleAccount: APPLE }), {
      code: "provider_conflict",
    });
    expect(localStorage.getItem(RECORD)).toBe(linked);
  });

  it("refuses an account another identity here already uses", () => {
    saveBrowserOnly();
    saveBrowserOnly(OTHER_KEY);
    const repository = new LocalStorageIdentityRepository();
    expectResultOk(repository.linkProviderAccount(OTHER_KEY, { appleAccount: APPLE }));

    expectResultError(repository.linkProviderAccount(KEY, { appleAccount: APPLE }), {
      code: "provider_in_use",
    });
    expect(JSON.parse(localStorage.getItem(RECORD)!)).not.toHaveProperty("appleAccount");
    expect(
      expectResultOk(
        repository.linkProviderAccount(KEY, {
          appleAccount: { ...APPLE, appleSubject: "another-apple-subject" },
        }),
      ),
    ).toBe("linked");
  });

  it("never overwrites a record that changed between its read and the write", () => {
    saveBrowserOnly();
    const changedElsewhere = JSON.stringify({
      ...(JSON.parse(localStorage.getItem(RECORD)!) as object),
      appleAccount: APPLE,
    });
    const getItem = localStorage.getItem.bind(localStorage);
    let reads = 0;
    vi.spyOn(localStorage, "getItem").mockImplementation((key: string) => {
      if (key === RECORD && ++reads === 2) localStorage.setItem(RECORD, changedElsewhere);
      return getItem(key);
    });

    expectResultError(
      new LocalStorageIdentityRepository().linkProviderAccount(KEY, { googleAccount: GOOGLE }),
      { code: "provider_conflict" },
    );
    expect(getItem(RECORD)).toBe(changedElsewhere);
  });

  it("rejects a missing identity, an invalid key or account, and both providers at once", () => {
    const repository = new LocalStorageIdentityRepository();
    expectResultError(repository.linkProviderAccount(KEY, { googleAccount: GOOGLE }), {
      code: "invalid_identity",
    });
    saveBrowserOnly();
    expectResultError(repository.linkProviderAccount("not-a-pubky", { googleAccount: GOOGLE }), {
      code: "invalid_identity",
    });
    expectResultError(
      repository.linkProviderAccount(KEY, {
        googleAccount: { ...GOOGLE, googleSubject: "" },
      }),
      { code: "invalid_identity" },
    );
    expectResultError(
      repository.linkProviderAccount(KEY, {
        googleAccount: GOOGLE,
        appleAccount: APPLE,
      } as never),
      { code: "invalid_identity" },
    );
    expect(JSON.parse(localStorage.getItem(RECORD)!)).not.toHaveProperty("googleAccount");
  });

  it("reports a damaged record and unavailable storage without writing", () => {
    localStorage.setItem(RECORD, "{");
    const repository = new LocalStorageIdentityRepository();
    expectResultError(repository.linkProviderAccount(KEY, { googleAccount: GOOGLE }), {
      code: "invalid_store",
    });
    expect(localStorage.getItem(RECORD)).toBe("{");

    localStorage.removeItem(RECORD);
    saveBrowserOnly();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expectResultError(repository.linkProviderAccount(KEY, { googleAccount: GOOGLE }), {
      code: "storage_unavailable",
      cause: new Error("quota"),
    });
    expect(JSON.parse(localStorage.getItem(RECORD)!)).not.toHaveProperty("googleAccount");
  });
});
