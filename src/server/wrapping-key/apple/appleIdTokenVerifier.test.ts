import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "@/libs/logger/logger";
import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import { APPLE_ISSUER, APPLE_KEYS_URL, AppleIdTokenVerifier } from "./AppleIdTokenVerifier";
import { AppleWrappingKeyIssuer } from "./AppleWrappingKeyIssuer";

const SERVICES_ID = "app.pubky.passport.signin";
const NOW_MS = Date.UTC(2026, 10, 5, 12, 0, 0);
const NOW = Math.floor(NOW_MS / 1000);

const KEY_A = rsaKey(2048);
const KEY_B = rsaKey(2048);

function rsaKey(modulusLength: number) {
  return generateKeyPairSync("rsa", { modulusLength });
}

function jwk(publicKey: KeyObject, kid: string, extra: Record<string, unknown> = {}) {
  return { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig", ...extra };
}

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: APPLE_ISSUER,
    aud: SERVICES_ID,
    exp: NOW + 600,
    iat: NOW,
    sub: "001234.abcdef.1234",
    nonce: "nonce-value",
    nonce_supported: true,
    ...overrides,
  };
}

function token(
  payload: Record<string, unknown> = claims(),
  options: { kid?: string; alg?: string; privateKey?: KeyObject } = {},
) {
  const header = { alg: options.alg ?? "RS256", kid: options.kid ?? "key-a" };
  const signedInput = `${b64(header)}.${b64(payload)}`;
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(signedInput),
    options.privateKey ?? KEY_A.privateKey,
  );
  return `${signedInput}.${signature.toString("base64url")}`;
}

function b64(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function keyServer(...responses: Array<Record<string, unknown>[] | Error>) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toBe(APPLE_KEYS_URL);
    const next = responses.length > 1 ? responses.shift() : responses[0];
    if (next instanceof Error) throw next;
    return Response.json({ keys: next });
  });
  return fetchImpl;
}

function verifier(fetchImpl: typeof fetch, now: () => number = () => NOW_MS) {
  return new AppleIdTokenVerifier(SERVICES_ID, fetchImpl, now);
}

describe("AppleIdTokenVerifier", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts a valid token and returns only issuer and subject", async () => {
    const result = await verifier(keyServer([jwk(KEY_A.publicKey, "key-a")])).verifyIdToken(
      token(),
    );

    expect(expectResultOk(result)).toEqual({
      provider: "apple",
      issuer: APPLE_ISSUER,
      subject: "001234.abcdef.1234",
    });
  });

  it.each([
    ["issuer", { iss: "https://accounts.google.com" }],
    ["audience", { aud: "other.services.id" }],
    ["audience list", { aud: [SERVICES_ID, "other"] }],
    ["expired", { exp: NOW }],
    ["missing expiry", { exp: undefined }],
    ["future issue time", { iat: NOW + 120 }],
    ["stale issue time", { iat: NOW - 15 * 60 }],
    ["missing nonce", { nonce: undefined }],
    ["empty nonce", { nonce: "" }],
    ["empty subject", { sub: " " }],
    ["long subject", { sub: "x".repeat(256) }],
  ])("rejects a token with a bad %s", async (_name, overrides) => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const result = await verifier(keyServer([jwk(KEY_A.publicKey, "key-a")])).verifyIdToken(
      token(claims(overrides)),
    );

    expectResultError(result, { code: "invalid_apple_id_token" });
  });

  it("accepts a single-entry audience list", async () => {
    const result = await verifier(keyServer([jwk(KEY_A.publicKey, "key-a")])).verifyIdToken(
      token(claims({ aud: [SERVICES_ID] })),
    );
    expect(Result.isOk(result)).toBe(true);
  });

  it.each(["none", "HS256", "RS512", "ES256"])("rejects the %s algorithm", async (alg) => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const result = await verifier(keyServer([jwk(KEY_A.publicKey, "key-a")])).verifyIdToken(
      token(claims(), { alg }),
    );
    expectResultError(result, { code: "invalid_apple_id_token" });
  });

  it("rejects a token signed by another key under a known key ID", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const result = await verifier(keyServer([jwk(KEY_A.publicKey, "key-a")])).verifyIdToken(
      token(claims(), { privateKey: KEY_B.privateKey }),
    );
    expectResultError(result, { code: "invalid_apple_id_token" });
  });

  it("rejects altered claims", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const [header, , signature] = token().split(".");
    const forged = `${header}.${b64(claims({ sub: "victim" }))}.${signature}`;
    const result = await verifier(keyServer([jwk(KEY_A.publicKey, "key-a")])).verifyIdToken(forged);
    expectResultError(result, { code: "invalid_apple_id_token" });
  });

  it.each(["", "a.b", "a.b.c.d", "a.b.c", `${"a".repeat(9000)}.b.c`, "e30.e30.@@"])(
    "rejects the malformed token %#",
    async (value) => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const fetchImpl = keyServer([jwk(KEY_A.publicKey, "key-a")]);
      const result = await verifier(fetchImpl).verifyIdToken(value);
      expectResultError(result, { code: "invalid_apple_id_token" });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("caches the key set and follows rotation to a new key ID", async () => {
    const fetchImpl = keyServer(
      [jwk(KEY_A.publicKey, "key-a")],
      [jwk(KEY_A.publicKey, "key-a"), jwk(KEY_B.publicKey, "key-b")],
    );
    const apple = verifier(fetchImpl);

    expect(Result.isOk(await apple.verifyIdToken(token()))).toBe(true);
    expect(Result.isOk(await apple.verifyIdToken(token()))).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();

    const rotated = token(claims(), { kid: "key-b", privateKey: KEY_B.privateKey });
    expect(Result.isOk(await apple.verifyIdToken(rotated))).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("limits forced refreshes for unknown key IDs", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    let now = NOW_MS;
    const fetchImpl = keyServer([jwk(KEY_A.publicKey, "key-a")]);
    const apple = verifier(fetchImpl, () => now);

    await apple.verifyIdToken(token(claims(), { kid: "unknown-1" }));
    await apple.verifyIdToken(token(claims(), { kid: "unknown-2" }));
    await apple.verifyIdToken(token(claims(), { kid: "unknown-3" }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    now += 61_000;
    await apple.verifyIdToken(token(claims({ iat: Math.floor(now / 1000) }), { kid: "unknown-4" }));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("refreshes a stale key set and keeps the old one when Apple is down", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    let now = NOW_MS;
    const fetchImpl = keyServer([jwk(KEY_A.publicKey, "key-a")], new Error("offline"));
    const apple = verifier(fetchImpl, () => now);
    expect(Result.isOk(await apple.verifyIdToken(token()))).toBe(true);

    now += 2 * 60 * 60 * 1000;
    const nowSeconds = Math.floor(now / 1000);
    const result = await apple.verifyIdToken(
      token(claims({ iat: nowSeconds, exp: nowSeconds + 600 })),
    );
    expect(Result.isOk(result)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("accepts exactly one spelling of each token part", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const apple = verifier(keyServer([jwk(KEY_A.publicKey, "key-a")]));
    const [header, payload, signature] = token().split(".") as [string, string, string];
    // RSA-2048 signatures are 256 bytes: 342 base64url characters with 4 spare trailing bits.
    const last = signature.at(-1) ?? "A";
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const alias = alphabet[alphabet.indexOf(last) ^ 1] ?? "A";
    const result = await apple.verifyIdToken(
      `${header}.${payload}.${signature.slice(0, -1)}${alias}`,
    );
    expectResultError(result, { code: "invalid_apple_id_token" });
  });

  it("backs off after a failed refresh and stops trusting keys older than a day", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    let now = NOW_MS;
    const fetchImpl = keyServer([jwk(KEY_A.publicKey, "key-a")], new Error("offline"));
    const apple = verifier(fetchImpl, () => now);
    const fresh = () => {
      const seconds = Math.floor(now / 1000);
      return token(claims({ iat: seconds, exp: seconds + 600 }));
    };
    expectResultOk(await apple.verifyIdToken(fresh()));

    now += 2 * 60 * 60 * 1000;
    expectResultOk(await apple.verifyIdToken(fresh()));
    expectResultOk(await apple.verifyIdToken(fresh()));
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    now += 25 * 60 * 60 * 1000;
    const result = await apple.verifyIdToken(fresh());
    expect(Result.isError(result) && result.error.code).toBe("apple_verifier_unavailable");
  });

  it("reports the verifier as unavailable when no key set can be fetched", async () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    const result = await verifier(keyServer(new Error("SECRET-NETWORK-DETAIL"))).verifyIdToken(
      token(),
    );

    expect(Result.isError(result) && result.error.code).toBe("apple_verifier_unavailable");
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-NETWORK-DETAIL");
  });

  it("does not refetch on every request while Apple's keys are unreachable", async () => {
    vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    let now = NOW_MS;
    const fetchImpl = keyServer(new Error("offline"));
    const apple = verifier(fetchImpl, () => now);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await apple.verifyIdToken(token());
      expect(Result.isError(result) && result.error.code).toBe("apple_verifier_unavailable");
    }
    expect(fetchImpl).toHaveBeenCalledOnce();
    now += 61_000;
    await apple.verifyIdToken(
      token(claims({ iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 600 })),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fetches once for a cold request naming an unknown key", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const fetchImpl = keyServer([jwk(KEY_A.publicKey, "key-a")]);
    expectResultError(
      await verifier(fetchImpl).verifyIdToken(token(claims(), { kid: "unknown" })),
      { code: "invalid_apple_id_token" },
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("shares one key fetch between concurrent requests", async () => {
    const fetchImpl = keyServer([jwk(KEY_A.publicKey, "key-a")]);
    const apple = verifier(fetchImpl);
    const results = await Promise.all([apple.verifyIdToken(token()), apple.verifyIdToken(token())]);
    expect(results.every(Result.isOk)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("ignores weak, non-RSA and non-signing keys", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const weak = rsaKey(1024);
    const fetchImpl = keyServer([
      jwk(weak.publicKey, "weak"),
      jwk(KEY_A.publicKey, "enc", { use: "enc" }),
      jwk(KEY_A.publicKey, "rs512", { alg: "RS512" }),
      jwk(KEY_A.publicKey, "key-a"),
    ]);
    const apple = verifier(fetchImpl);

    expect(Result.isOk(await apple.verifyIdToken(token()))).toBe(true);
    for (const [kid, privateKey] of [
      ["weak", weak.privateKey],
      ["enc", KEY_A.privateKey],
      ["rs512", KEY_A.privateKey],
    ] as const) {
      expectResultError(await apple.verifyIdToken(token(claims(), { kid, privateKey })), {
        code: "invalid_apple_id_token",
      });
    }
  });

  it("never logs the token or its claims", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const value = token(claims({ aud: "wrong", sub: "SECRET-SUBJECT" }));
    await verifier(keyServer([jwk(KEY_A.publicKey, "key-a")])).verifyIdToken(value);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-SUBJECT");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(value.slice(0, 40));
  });

  it("keeps the email claim out of results and server logs", async () => {
    const email = "SECRET-EMAIL@privaterelay.appleid.com";
    const spies = [
      ...(["debug", "info", "warn", "error"] as const).map((level) =>
        vi.spyOn(LOGGER, level).mockImplementation(() => undefined),
      ),
      ...(["debug", "info", "log", "warn", "error"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => undefined),
      ),
    ];
    const withEmail = (overrides: Record<string, unknown> = {}) =>
      claims({ email, email_verified: "true", is_private_email: "true", ...overrides });
    const issuer = new AppleWrappingKeyIssuer(
      SERVICES_ID,
      "current",
      new Map([["current", Buffer.alloc(32, 3)]]),
      verifier(keyServer([jwk(KEY_A.publicKey, "key-a")])),
    );

    const results = [
      await issuer.issueWrappingKey(token(withEmail())),
      await issuer.issueWrappingKey(token(withEmail({ aud: "wrong" }))),
      await issuer.issueWrappingKey(token(withEmail({ exp: NOW - 1 }))),
      await issuer.issueWrappingKey(token(withEmail(), { privateKey: KEY_B.privateKey })),
      await issuer.issueWrappingKey(token(withEmail(), { kid: "unknown" })),
    ];

    expect(expectResultOk(results[0] as never)).toEqual({
      wrappingKey: expect.any(String),
      keyId: "current",
    });
    expect(JSON.stringify(results)).not.toContain(email);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(email);
  });
});
