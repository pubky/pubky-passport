import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { encodeBase64Url } from "../../../../libs/encoding/base64Url";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { BrowserPasskeyPrfKeySource } from "./BrowserPasskeyPrfKeySource";

const CREDENTIAL_ID_BYTES = new Uint8Array(32).fill(3);
const CREDENTIAL_ID = encodeBase64Url(CREDENTIAL_ID_BYTES);
const PRF_INPUT = new Uint8Array(32).fill(5);
const PRF_OUTPUT = new Uint8Array(32).fill(7);

describe("BrowserPasskeyPrfKeySource", () => {
  it("creates a user-verifying platform passkey and returns a copied PRF output", async () => {
    const create = vi.fn(async () =>
      credential(CREDENTIAL_ID_BYTES, { prf: { enabled: true, results: { first: PRF_OUTPUT } } }),
    );
    const get = vi.fn();
    const source = keySource(create, get);

    const enrollment = expectResultOk(await source.createCredential(PRF_INPUT));

    expect(enrollment).toEqual({ credentialId: CREDENTIAL_ID, prfOutput: PRF_OUTPUT });
    expect(enrollment.prfOutput).not.toBe(PRF_OUTPUT);
    expect(get).not.toHaveBeenCalled();
    const publicKey = creationOptionsFrom(create).publicKey;
    expect(publicKey?.authenticatorSelection).toEqual({
      authenticatorAttachment: "platform",
      requireResidentKey: true,
      residentKey: "required",
      userVerification: "required",
    });
    expect(publicKey?.attestation).toBe("none");
    expect(publicKey?.rp).toEqual({ id: "passport.test", name: "Passport test" });
    expect(new Uint8Array(publicKey?.extensions?.prf?.eval?.first as ArrayBuffer)).toEqual(
      PRF_INPUT,
    );
  });

  it("uses an assertion when registration cannot evaluate the PRF", async () => {
    const create = vi.fn(async () => credential(CREDENTIAL_ID_BYTES, { prf: { enabled: true } }));
    const get = vi.fn(async () =>
      credential(CREDENTIAL_ID_BYTES, { prf: { results: { first: PRF_OUTPUT } } }),
    );
    const source = keySource(create, get);

    expectResultOk(await source.createCredential(PRF_INPUT));

    const publicKey = requestOptionsFrom(get).publicKey;
    expect(publicKey?.userVerification).toBe("required");
    expect(publicKey?.rpId).toBe("passport.test");
    expect(new Uint8Array(publicKey?.allowCredentials?.[0]?.id as ArrayBuffer)).toEqual(
      CREDENTIAL_ID_BYTES,
    );
    expect(
      new Uint8Array(
        publicKey?.extensions?.prf?.evalByCredential?.[CREDENTIAL_ID]?.first as ArrayBuffer,
      ),
    ).toEqual(PRF_INPUT);
  });

  it("fails closed when PRF support is absent", async () => {
    const source = keySource(
      vi.fn(async () => credential(CREDENTIAL_ID_BYTES, { prf: { enabled: false } })),
      vi.fn(),
    );

    expectResultError(await source.createCredential(PRF_INPUT), { code: "prf_unsupported" });
  });

  it("rejects a malformed PRF result without using it as key material", async () => {
    const source = keySource(
      vi.fn(async () =>
        credential(CREDENTIAL_ID_BYTES, {
          prf: { enabled: true, results: { first: new Uint8Array(31) } },
        }),
      ),
      vi.fn(),
    );

    expectResultError(await source.createCredential(PRF_INPUT), { code: "invalid_credential" });
  });

  it("classifies cancellation and rejects a mismatched assertion credential", async () => {
    const cancelled = keySource(
      vi.fn(async () => {
        throw new DOMException("cancelled", "NotAllowedError");
      }),
      vi.fn(),
    );
    const cancellation = await cancelled.createCredential(PRF_INPUT);
    expect(Result.isError(cancellation) && cancellation.error.code).toBe("credential_cancelled");

    const mismatched = keySource(
      vi.fn(),
      vi.fn(async () =>
        credential(new Uint8Array(32).fill(9), {
          prf: { results: { first: PRF_OUTPUT } },
        }),
      ),
    );
    expectResultError(await mismatched.evaluate(CREDENTIAL_ID, PRF_INPUT), {
      code: "invalid_credential",
    });
  });
});

function keySource(
  create: ReturnType<typeof vi.fn>,
  get: ReturnType<typeof vi.fn>,
): BrowserPasskeyPrfKeySource {
  return new BrowserPasskeyPrfKeySource(
    { create, get } as unknown as Pick<CredentialsContainer, "create" | "get">,
    crypto,
    "passport.test",
    "Passport test",
  );
}

function creationOptionsFrom(mock: ReturnType<typeof vi.fn>): CredentialCreationOptions {
  return mock.mock.calls[0]?.[0] as CredentialCreationOptions;
}

function requestOptionsFrom(mock: ReturnType<typeof vi.fn>): CredentialRequestOptions {
  return mock.mock.calls[0]?.[0] as CredentialRequestOptions;
}

function credential(
  rawId: Uint8Array,
  extensionResults: AuthenticationExtensionsClientOutputs,
): PublicKeyCredential {
  return {
    type: "public-key",
    rawId: Uint8Array.from(rawId).buffer,
    getClientExtensionResults: () => extensionResults,
  } as PublicKeyCredential;
}
