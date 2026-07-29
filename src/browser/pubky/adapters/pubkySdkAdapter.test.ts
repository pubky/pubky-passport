import { Keypair } from "@synonymdev/pubky";
import { describe, expect, it, vi } from "vitest";
import { Result, type Result as ResultType } from "better-result";

import type { ValidatedSensitivePubkyAuthRequest } from "../../../core/auth/parsePubkyAuthRequest";
import { PUBKY_SECRET_KEY_BYTES, PUBKY_SECRET_KEY_FORMAT, type PubkyIdentityKeyHandle } from "../application/pubkyIdentityKeys";
import { PubkySdkAdapter } from "./pubkySdkAdapter";

describe("PubkySdkAdapter", () => {
  it("creates an opaque key handle and derives public identity", async () => {
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const identity = expectOk(await pubky.getPublicIdentity({ keyHandle: created.keyHandle }));

      expect(identity).toEqual(created.publicIdentity);
      expect(identity.publicKeyZ32).toMatch(/^[13456789abcdefghijkmnopqrstuwxyz]+$/);
      expect(identity.publicKeyDisplay).toBe(`pubky${identity.publicKeyZ32}`);
    } finally {
      pubky.dispose();
    }
  });

  it("exports and restores 32-byte key material without retaining plaintext input", async () => {
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const exported = expectOk(await pubky.exportSecretKey({ keyHandle: created.keyHandle }));

      expect(exported.format).toBe(PUBKY_SECRET_KEY_FORMAT);
      expect(exported.bytes).toHaveLength(PUBKY_SECRET_KEY_BYTES);

      const restored = expectOk(await pubky.restoreIdentityKey({ secretKey: exported }));

      expect(exported.bytes).toEqual(new Uint8Array(PUBKY_SECRET_KEY_BYTES));
      expect(restored.publicIdentity).toEqual(created.publicIdentity);
    } finally {
      pubky.dispose();
    }
  });

  it("rejects and clears invalid key material before restoration", async () => {
    const pubky = new PubkySdkAdapter();
    const bytes = new Uint8Array(PUBKY_SECRET_KEY_BYTES - 1).fill(7);

    try {
      await expectError(
        pubky.restoreIdentityKey({ secretKey: { bytes, format: PUBKY_SECRET_KEY_FORMAT } }),
        "invalid_secret_key",
      );
      expect(bytes).toEqual(new Uint8Array(PUBKY_SECRET_KEY_BYTES - 1));
    } finally {
      pubky.dispose();
    }
  });

  it("returns safe unavailable errors for unknown key handles", async () => {
    const pubky = new PubkySdkAdapter();
    const keyHandle = {} as PubkyIdentityKeyHandle;

    try {
      await expectError(pubky.getPublicIdentity({ keyHandle }), "key_unavailable");
      await expectError(pubky.exportSecretKey({ keyHandle }), "key_unavailable");
      await expectError(pubky.signup({ keyHandle, homeserverPubky: "not used" }), "key_unavailable");
      await expectError(pubky.publishHomeserverIfStale({ keyHandle }), "key_unavailable");
    } finally {
      pubky.dispose();
    }
  });

  it("maps invalid homeserver values without exposing signup codes", async () => {
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const signup = await pubky.signup({
        keyHandle: created.keyHandle,
        homeserverPubky: "not a public key",
        signupCode: "sensitive-signup-code",
      });
      const discovery = await pubky.publishHomeserverIfStale({
        keyHandle: created.keyHandle,
        homeserverPubky: "not a public key",
      });

      expectErrorResult(signup, "invalid_homeserver_pubky");
      expectErrorResult(discovery, "invalid_homeserver_pubky");
      expect(JSON.stringify(signup)).not.toContain("sensitive-signup-code");
    } finally {
      pubky.dispose();
    }
  });

  it("rejects auth requests not issued by the parser before SDK approval", async () => {
    const pubky = new PubkySdkAdapter();

    try {
      const result = await pubky.approveAuthRequest({
        keyHandle: {} as PubkyIdentityKeyHandle,
        authRequest: {
          sensitivePubkyAuthUrl:
            "pubkyauth://signin?secret=should-not-be-returned&relay=https://httprelay.pubky.app/inbox&caps=/pub/pubky.app/:rw" as ValidatedSensitivePubkyAuthRequest["sensitivePubkyAuthUrl"],
        },
      });

      expectErrorResult(result, "request_rejected");
      expect(JSON.stringify(result)).not.toContain("should-not-be-returned");
    } finally {
      pubky.dispose();
    }
  });

  it("disposes keypairs and rejects old handles", async () => {
    const pubky = new PubkySdkAdapter();
    const created = expectOk(await pubky.createIdentityKey());

    pubky.dispose();
    pubky.dispose();

    await expectError(pubky.getPublicIdentity({ keyHandle: created.keyHandle }), "key_unavailable");
    await expectError(pubky.createIdentityKey(), "key_unavailable");
  });

  it("invalidates handles before freeing and continues after cleanup failures", async () => {
    const pubky = new PubkySdkAdapter();
    const individuallyDisposed = expectOk(await pubky.createIdentityKey());
    const firstBulkHandle = expectOk(await pubky.createIdentityKey()).keyHandle;
    const secondBulkHandle = expectOk(await pubky.createIdentityKey()).keyHandle;
    const free = vi.spyOn(Keypair.prototype, "free");

    free.mockImplementationOnce(() => { throw new Error("free failed"); });
    expect(() => pubky.disposeIdentityKey({ keyHandle: individuallyDisposed.keyHandle })).not.toThrow();
    await expectError(pubky.getPublicIdentity({ keyHandle: individuallyDisposed.keyHandle }), "key_unavailable");

    free.mockImplementationOnce(() => { throw new Error("free failed"); });
    expect(() => pubky.dispose()).not.toThrow();
    expect(free).toHaveBeenCalledTimes(3);
    await expectError(pubky.getPublicIdentity({ keyHandle: firstBulkHandle }), "key_unavailable");
    await expectError(pubky.getPublicIdentity({ keyHandle: secondBulkHandle }), "key_unavailable");
  });
});

async function expectError<T>(result: Promise<ResultType<T, { code: string }>>, code: string): Promise<void> {
  expectErrorResult(await result, code);
}

function expectErrorResult(result: ResultType<unknown, { code: string }>, code: string): void {
  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) {
    expect(result.error).toEqual({ code });
  }
}

function expectOk<T>(result: ResultType<T, unknown>): T {
  expect(Result.isOk(result)).toBe(true);
  if (Result.isError(result)) {
    throw result.error;
  }

  return result.value;
}
