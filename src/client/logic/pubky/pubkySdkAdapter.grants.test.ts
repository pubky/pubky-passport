import { Signer, type Session } from "@synonymdev/pubky";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectResultOk as expectOk } from "@test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
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
    GRANTS.revoke.mockRejectedValue(
      Object.assign(new Error("Not Found"), {
        name: "RequestError",
        data: { reason: "Http", statusCode: 404 },
      }),
    );
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      expectOk(await pubky.revokeAuthorizedApp(created.keyHandle, "grant-gone"));
      expect(root.signout).toHaveBeenCalledOnce();
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

function fakeGrantInfo(grantId: string, clientId: string, capabilities: string) {
  const free = vi.fn();
  return {
    free,
    grant: {
      grantId,
      clientId,
      capabilities,
      issuedAt: 1_767_225_600,
      expiresAt: 1_769_904_000,
      free,
    },
  };
}
