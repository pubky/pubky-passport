import { Signer, type Session } from "@synonymdev/pubky";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectResultOk as expectOk } from "@test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import type { PassportSessionLedger } from "./passportSessionLedger";
import { PubkySdkAdapter } from "./PubkySdkAdapter";

const GRANTS = vi.hoisted(() => ({
  list: vi.fn(),
  managerFree: vi.fn(),
  revoke: vi.fn(),
  sessions: [] as unknown[],
}));

vi.mock("@synonymdev/pubky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@synonymdev/pubky")>();
  class FakeGrantManager {
    constructor(session: unknown) {
      GRANTS.sessions.push(session);
    }
    free = GRANTS.managerFree;
    list = GRANTS.list;
    revoke = GRANTS.revoke;
  }
  return { ...actual, GrantManager: FakeGrantManager };
});

afterEach(() => {
  vi.restoreAllMocks();
  GRANTS.list.mockReset();
  GRANTS.managerFree.mockReset();
  GRANTS.revoke.mockReset();
  GRANTS.sessions.length = 0;
});

describe("PubkySdkAdapter grant management", () => {
  it("lists other apps' grants and hides the root session's own grant", async () => {
    const root = fakeRootSession("own-grant");
    const signin = vi.spyOn(Signer.prototype, "signin").mockResolvedValue(root.session);
    const grants = [
      fakeGrantInfo("own-grant", "passport.pubky.app", "/:rw"),
      fakeGrantInfo("grant-1", "demo.pubky.app", "/pub/demo.pubky.app/:rw, /pub/shared/:r"),
      fakeGrantInfo("grant-2", "notes.example", ""),
    ];
    GRANTS.list.mockResolvedValue(grants.map(({ grant }) => grant));
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const apps = expectOk(await pubky.listAuthorizedApps(created.keyHandle));

      expect(apps).toEqual([
        {
          grantId: "grant-1",
          clientId: "demo.pubky.app",
          capabilities: ["/pub/demo.pubky.app/:rw", "/pub/shared/:r"],
          issuedAt: 1_767_225_600,
          expiresAt: 1_769_904_000,
        },
        {
          grantId: "grant-2",
          clientId: "notes.example",
          capabilities: [],
          issuedAt: 1_767_225_600,
          expiresAt: 1_769_904_000,
        },
      ]);
      expect(Object.isFrozen(apps)).toBe(true);
      expect(signin).toHaveBeenCalledWith("passport.pubky.app");
      expect(GRANTS.sessions).toEqual([root.session]);
      for (const { free } of grants) expect(free).toHaveBeenCalledOnce();
      expect(GRANTS.managerFree).toHaveBeenCalledOnce();
      expect(root.grantFree).toHaveBeenCalledOnce();
      expect(root.signout).toHaveBeenCalledOnce();
      expect(root.free).toHaveBeenCalledOnce();
    } finally {
      pubky.dispose();
    }
  });

  it("returns a safe list failure and still signs out the root session", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const root = fakeRootSession("own-grant");
    vi.spyOn(Signer.prototype, "signin").mockResolvedValue(root.session);
    const cause = Object.assign(new Error("SECRET-GRANT-CANARY"), { name: "RequestError" });
    GRANTS.list.mockRejectedValue(cause);
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const result = await pubky.listAuthorizedApps(created.keyHandle);

      expect(Result.isError(result) && result.error).toEqual({ code: "list_failed", cause });
      expect(root.signout).toHaveBeenCalledOnce();
      expect(root.free).toHaveBeenCalledOnce();
      expect(GRANTS.managerFree).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        "identity.pubky.operation.failed",
        expect.objectContaining({
          operation: "list_authorized_apps",
          stage: "sdk_grants",
          sdkErrorName: "RequestError",
          code: "list_failed",
        }),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-GRANT-CANARY");
    } finally {
      pubky.dispose();
    }
  });

  it("returns a list failure when root sign-in fails", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    vi.spyOn(Signer.prototype, "signin").mockRejectedValue(new Error("offline"));
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const result = await pubky.listAuthorizedApps(created.keyHandle);

      expect(Result.isError(result) && result.error.code).toBe("list_failed");
      expect(GRANTS.list).not.toHaveBeenCalled();
    } finally {
      pubky.dispose();
    }
  });

  it("keeps a listed result when signout fails", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const root = fakeRootSession("own-grant");
    root.signout.mockRejectedValue(new Error("signout failed"));
    vi.spyOn(Signer.prototype, "signin").mockResolvedValue(root.session);
    GRANTS.list.mockResolvedValue([]);
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());

      expect(expectOk(await pubky.listAuthorizedApps(created.keyHandle))).toEqual([]);
      expect(root.free).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        "identity.pubky.cleanup.failed",
        expect.objectContaining({ operation: "list_authorized_apps", stage: "session_signout" }),
      );
    } finally {
      pubky.dispose();
    }
  });

  it("revokes recorded Passport leftovers and lists every other grant", async () => {
    const root = fakeRootSession("own-grant");
    vi.spyOn(Signer.prototype, "signin").mockResolvedValue(root.session);
    vi.spyOn(Date, "now").mockReturnValue(NOW_SECONDS * 1000);
    const ledger = memoryLedger();
    const grants = [
      fakeGrantInfo("own-grant", "passport.pubky.app", "/:rw", NOW_SECONDS),
      fakeGrantInfo("leftover", "passport.pubky.app", "/:rw", NOW_SECONDS - 3600),
      fakeGrantInfo("gone", "passport.pubky.app", "/:rw", NOW_SECONDS - 600),
      fakeGrantInfo("other-tab", "passport.pubky.app", "/:rw", NOW_SECONDS - 599),
      fakeGrantInfo("not-recorded", "passport.pubky.app", "/:rw", NOW_SECONDS - 3600),
      fakeGrantInfo("scoped", "passport.pubky.app", "/pub/passport.pubky.app/:rw", 0),
      fakeGrantInfo("app", "demo.pubky.app", "/:rw", 0),
    ];
    GRANTS.list.mockResolvedValue(grants.map(({ grant }) => grant));
    GRANTS.revoke.mockImplementation(async (grantId: string) => {
      if (grantId === "gone") throw notFoundError();
    });
    const pubky = new PubkySdkAdapter(ledger);

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const owner = created.publicIdentity.publicKeyZ32;
      for (const id of ["leftover", "gone", "other-tab", "scoped", "app", "expired"]) {
        ledger.record(owner, id);
      }
      const apps = expectOk(await pubky.listAuthorizedApps(created.keyHandle));

      expect(GRANTS.revoke.mock.calls).toEqual([["leftover"], ["gone"]]);
      // An unrecorded grant under Passport's client id may belong to an app: never auto-revoked.
      expect(apps.map((app) => app.grantId)).toEqual([
        "other-tab",
        "not-recorded",
        "scoped",
        "app",
      ]);
      // Revoked and no-longer-listed records are dropped; the root session's own was signed out.
      expect([...ledger.recorded(owner)]).toEqual(["other-tab", "scoped", "app"]);
      for (const { free } of grants) expect(free).toHaveBeenCalledOnce();
      expect(root.signout).toHaveBeenCalledOnce();
    } finally {
      pubky.dispose();
    }
  });

  it("keeps a leftover Passport grant listed and recorded when revoking it fails", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const root = fakeRootSession("own-grant");
    vi.spyOn(Signer.prototype, "signin").mockResolvedValue(root.session);
    GRANTS.list.mockResolvedValue([
      fakeGrantInfo("leftover", "passport.pubky.app", "/:rw").grant,
      fakeGrantInfo("grant-1", "demo.pubky.app", "/pub/demo.pubky.app/:rw").grant,
    ]);
    GRANTS.revoke.mockRejectedValue(
      Object.assign(new Error("SECRET-REVOKE-CANARY"), { name: "RequestError" }),
    );
    const ledger = memoryLedger();
    const pubky = new PubkySdkAdapter(ledger);

    try {
      const created = expectOk(await pubky.createIdentityKey());
      ledger.record(created.publicIdentity.publicKeyZ32, "leftover");
      const apps = expectOk(await pubky.listAuthorizedApps(created.keyHandle));

      expect(apps.map((app) => app.grantId)).toEqual(["leftover", "grant-1"]);
      expect(GRANTS.revoke).toHaveBeenCalledExactlyOnceWith("leftover");
      expect([...ledger.recorded(created.publicIdentity.publicKeyZ32)]).toEqual(["leftover"]);
      expect(warn).toHaveBeenCalledWith(
        "identity.pubky.cleanup.failed",
        expect.objectContaining({
          operation: "list_authorized_apps",
          stage: "leftover_grant_revoke",
          code: "cleanup_failed",
        }),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-REVOKE-CANARY");
      expect(root.signout).toHaveBeenCalledOnce();
    } finally {
      pubky.dispose();
    }
  });

  it("records each root session until its signout succeeds", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const ledger = memoryLedger();
    const signedOut = fakeRootSession("signed-out");
    const failed = fakeRootSession("signout-failed");
    failed.signout.mockRejectedValue(new Error("offline"));
    vi.spyOn(Signer.prototype, "signin")
      .mockResolvedValueOnce(signedOut.session)
      .mockResolvedValueOnce(failed.session);
    GRANTS.list.mockResolvedValue([]);
    const pubky = new PubkySdkAdapter(ledger);

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const owner = created.publicIdentity.publicKeyZ32;
      const record = vi.spyOn(ledger, "record");

      expectOk(await pubky.listAuthorizedApps(created.keyHandle));
      expectOk(await pubky.listAuthorizedApps(created.keyHandle));

      expect(record.mock.calls).toEqual([
        [owner, "signed-out"],
        [owner, "signout-failed"],
      ]);
      expect([...ledger.recorded(owner)]).toEqual(["signout-failed"]);
    } finally {
      pubky.dispose();
    }
  });

  it("revokes another app's grant with a root session", async () => {
    const root = fakeRootSession("own-grant");
    vi.spyOn(Signer.prototype, "signin").mockResolvedValue(root.session);
    GRANTS.revoke.mockResolvedValue(undefined);
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      expectOk(await pubky.revokeAuthorizedApp(created.keyHandle, "grant-1"));

      expect(GRANTS.revoke).toHaveBeenCalledWith("grant-1");
      expect(root.signout).toHaveBeenCalledOnce();
      expect(root.free).toHaveBeenCalledOnce();
    } finally {
      pubky.dispose();
    }
  });

  it("refuses to revoke the root session's own grant or an empty id", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const root = fakeRootSession("own-grant");
    const signin = vi.spyOn(Signer.prototype, "signin").mockResolvedValue(root.session);
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const empty = await pubky.revokeAuthorizedApp(created.keyHandle, " ");
      expect(Result.isError(empty) && empty.error.code).toBe("invalid_grant_id");
      expect(signin).not.toHaveBeenCalled();

      const own = await pubky.revokeAuthorizedApp(created.keyHandle, "own-grant");
      expect(Result.isError(own) && own.error.code).toBe("invalid_grant_id");
      expect(GRANTS.revoke).not.toHaveBeenCalled();
      expect(root.signout).toHaveBeenCalledOnce();
    } finally {
      pubky.dispose();
    }
  });

  it("treats a grant the homeserver no longer knows as revoked", async () => {
    const root = fakeRootSession("own-grant");
    vi.spyOn(Signer.prototype, "signin").mockResolvedValue(root.session);
    GRANTS.revoke.mockRejectedValue(notFoundError());
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      expectOk(await pubky.revokeAuthorizedApp(created.keyHandle, "grant-gone"));
      expect(root.signout).toHaveBeenCalledOnce();
    } finally {
      pubky.dispose();
    }
  });

  it("returns a revoke failure when root sign-in returns 404", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = notFoundError();
    vi.spyOn(Signer.prototype, "signin").mockRejectedValue(cause);
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const result = await pubky.revokeAuthorizedApp(created.keyHandle, "grant-1");

      expect(Result.isError(result) && result.error).toEqual({ code: "revoke_failed", cause });
      expect(GRANTS.revoke).not.toHaveBeenCalled();
    } finally {
      pubky.dispose();
    }
  });

  it("returns a revoke failure from the SDK", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const root = fakeRootSession("own-grant");
    vi.spyOn(Signer.prototype, "signin").mockResolvedValue(root.session);
    const cause = Object.assign(new Error("bad id"), { name: "InvalidInput" });
    GRANTS.revoke.mockRejectedValue(cause);
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const result = await pubky.revokeAuthorizedApp(created.keyHandle, "grant-1");

      expect(Result.isError(result) && result.error).toEqual({ code: "revoke_failed", cause });
      expect(root.signout).toHaveBeenCalledOnce();
    } finally {
      pubky.dispose();
    }
  });

  it("returns unavailable for unknown or disposed key handles", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const signin = vi.spyOn(Signer.prototype, "signin");
    const pubky = new PubkySdkAdapter();
    const created = expectOk(await pubky.createIdentityKey());
    pubky.dispose();

    const listed = await pubky.listAuthorizedApps(created.keyHandle);
    const revoked = await pubky.revokeAuthorizedApp(created.keyHandle, "grant-1");

    expect(Result.isError(listed) && listed.error.code).toBe("key_unavailable");
    expect(Result.isError(revoked) && revoked.error.code).toBe("key_unavailable");
    expect(signin).not.toHaveBeenCalled();
  });
});

const NOW_SECONDS = 1_800_000_000;

function memoryLedger(): PassportSessionLedger {
  const grants = new Map<string, string[]>();
  return {
    record(owner, grantId) {
      grants.set(owner, [...(grants.get(owner) ?? []).filter((id) => id !== grantId), grantId]);
    },
    forget(owner, grantIds) {
      grants.set(
        owner,
        (grants.get(owner) ?? []).filter((id) => !grantIds.includes(id)),
      );
    },
    recorded(owner) {
      return new Set(grants.get(owner) ?? []);
    },
  };
}

function notFoundError() {
  return Object.assign(new Error("Not Found"), {
    name: "RequestError",
    data: { reason: "Http", statusCode: 404 },
  });
}

function fakeRootSession(grantId: string) {
  const grantFree = vi.fn();
  const signout = vi.fn().mockResolvedValue(undefined);
  const free = vi.fn();
  const session = {
    get grant() {
      return { grantId: vi.fn().mockResolvedValue(grantId), free: grantFree };
    },
    signout,
    free,
  } as unknown as Session;
  return { free, grantFree, session, signout };
}

function fakeGrantInfo(
  grantId: string,
  clientId: string,
  capabilities: string,
  issuedAt = 1_767_225_600,
) {
  const free = vi.fn();
  return {
    free,
    grant: {
      grantId,
      clientId,
      capabilities,
      issuedAt,
      expiresAt: 1_769_904_000,
      free,
    },
  };
}
