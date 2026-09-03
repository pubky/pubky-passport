import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { decodeBase64Url, encodeBase64Url } from "../../../../libs/encoding/base64Url";
import type { CodedFailure } from "../../../../libs/result";

export const PASSKEY_PRF_INPUT_BYTES = 32;
const WEBAUTHN_CHALLENGE_BYTES = 32;
const MAXIMUM_CREDENTIAL_ID_BYTES = 1023;
const MAXIMUM_CREDENTIAL_ID_CHARACTERS = Math.ceil((MAXIMUM_CREDENTIAL_ID_BYTES * 4) / 3);
const WEBAUTHN_TIMEOUT_MS = 60_000;

export type PasskeyPrfErrorCode =
  | "credential_cancelled"
  | "invalid_credential"
  | "invalid_prf_input"
  | "prf_unsupported"
  | "webauthn_failed"
  | "webauthn_unavailable";

export type PasskeyPrfResult<Success> = ResultType<Success, CodedFailure<PasskeyPrfErrorCode>>;

export type PasskeyPrfEnrollment = Readonly<{
  credentialId: string;
  prfOutput: Uint8Array;
}>;

export interface PasskeyPrfKeySource {
  createCredential(prfInput: Uint8Array): Promise<PasskeyPrfResult<PasskeyPrfEnrollment>>;
  evaluate(credentialId: string, prfInput: Uint8Array): Promise<PasskeyPrfResult<Uint8Array>>;
}

type WebAuthnCredentials = Pick<CredentialsContainer, "create" | "get">;
type RandomSource = Pick<Crypto, "getRandomValues">;

/**
 * Requests a user-verifying platform credential and evaluates its WebAuthn PRF.
 * Returned PRF bytes are fresh caller-owned copies and should be released as soon
 * as the caller has derived a non-extractable key from them. Browser, authenticator,
 * cancellation, and malformed-output failures are represented as Results.
 */
export class BrowserPasskeyPrfKeySource implements PasskeyPrfKeySource {
  constructor(
    private readonly credentials: WebAuthnCredentials,
    private readonly randomSource: RandomSource,
    private readonly rpId: string,
    private readonly rpName = "Pubky Passport",
  ) {}

  async createCredential(prfInput: Uint8Array): Promise<PasskeyPrfResult<PasskeyPrfEnrollment>> {
    if (!isPrfInput(prfInput)) return Result.err({ code: "invalid_prf_input" });

    try {
      const credential = asPublicKeyCredential(
        await this.credentials.create({
          publicKey: {
            attestation: "none",
            authenticatorSelection: {
              authenticatorAttachment: "platform",
              requireResidentKey: true,
              residentKey: "required",
              userVerification: "required",
            },
            challenge: copyToArrayBuffer(this.randomBytes(WEBAUTHN_CHALLENGE_BYTES)),
            extensions: { prf: { eval: { first: copyToArrayBuffer(prfInput) } } },
            pubKeyCredParams: [
              { alg: -7, type: "public-key" },
              { alg: -257, type: "public-key" },
            ],
            rp: { id: this.rpId, name: this.rpName },
            timeout: WEBAUTHN_TIMEOUT_MS,
            user: {
              displayName: "Local Passport vault",
              id: copyToArrayBuffer(this.randomBytes(32)),
              name: "local-passport-vault",
            },
          },
        }),
      );
      if (!credential) return Result.err({ code: "invalid_credential" });

      const credentialId = encodeCredentialId(credential.rawId);
      if (!credentialId) return Result.err({ code: "invalid_credential" });

      const extensionResults = credential.getClientExtensionResults().prf;
      if (extensionResults?.enabled !== true) return Result.err({ code: "prf_unsupported" });

      const registrationResult = extensionResults.results?.first;
      if (registrationResult !== undefined) {
        const registrationOutput = copyPrfOutput(registrationResult);
        return registrationOutput
          ? Result.ok({ credentialId, prfOutput: registrationOutput })
          : Result.err({ code: "invalid_credential" });
      }

      const assertionOutput = await this.evaluate(credentialId, prfInput);
      return Result.isError(assertionOutput)
        ? Result.err(assertionOutput.error)
        : Result.ok({ credentialId, prfOutput: assertionOutput.value });
    } catch (cause) {
      return Result.err(classifyWebAuthnFailure(cause));
    }
  }

  async evaluate(
    credentialId: string,
    prfInput: Uint8Array,
  ): Promise<PasskeyPrfResult<Uint8Array>> {
    if (!isPrfInput(prfInput)) return Result.err({ code: "invalid_prf_input" });
    const credentialIdBytes = decodeCredentialId(credentialId);
    if (!credentialIdBytes) return Result.err({ code: "invalid_credential" });

    try {
      const credential = asPublicKeyCredential(
        await this.credentials.get({
          publicKey: {
            allowCredentials: [{ id: copyToArrayBuffer(credentialIdBytes), type: "public-key" }],
            challenge: copyToArrayBuffer(this.randomBytes(WEBAUTHN_CHALLENGE_BYTES)),
            extensions: {
              prf: {
                evalByCredential: {
                  [credentialId]: { first: copyToArrayBuffer(prfInput) },
                },
              },
            },
            rpId: this.rpId,
            timeout: WEBAUTHN_TIMEOUT_MS,
            userVerification: "required",
          },
        }),
      );
      if (!credential || encodeCredentialId(credential.rawId) !== credentialId) {
        return Result.err({ code: "invalid_credential" });
      }

      const assertionResult = credential.getClientExtensionResults().prf?.results?.first;
      if (assertionResult === undefined) return Result.err({ code: "prf_unsupported" });
      const output = copyPrfOutput(assertionResult);
      return output ? Result.ok(output) : Result.err({ code: "invalid_credential" });
    } catch (cause) {
      return Result.err(classifyWebAuthnFailure(cause));
    }
  }

  private randomBytes(byteLength: number): Uint8Array {
    const bytes = new Uint8Array(byteLength);
    this.randomSource.getRandomValues(bytes);
    return bytes;
  }
}

function asPublicKeyCredential(value: Credential | null): PublicKeyCredential | null {
  if (!value || value.type !== "public-key") return null;
  const candidate = value as Partial<PublicKeyCredential>;
  return candidate.rawId instanceof ArrayBuffer &&
    typeof candidate.getClientExtensionResults === "function"
    ? (candidate as PublicKeyCredential)
    : null;
}

function encodeCredentialId(rawId: ArrayBuffer): string | null {
  const bytes = new Uint8Array(rawId);
  return bytes.byteLength > 0 && bytes.byteLength <= MAXIMUM_CREDENTIAL_ID_BYTES
    ? encodeBase64Url(bytes)
    : null;
}

function decodeCredentialId(value: string): Uint8Array | undefined {
  if (value.length > MAXIMUM_CREDENTIAL_ID_CHARACTERS) return undefined;
  const bytes = decodeBase64Url(value);
  return bytes && bytes.byteLength > 0 && bytes.byteLength <= MAXIMUM_CREDENTIAL_ID_BYTES
    ? bytes
    : undefined;
}

function copyPrfOutput(value: BufferSource | undefined): Uint8Array | null {
  if (value === undefined) return null;
  const bytes = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  return bytes.byteLength === PASSKEY_PRF_INPUT_BYTES ? Uint8Array.from(bytes) : null;
}

function isPrfInput(value: Uint8Array): boolean {
  return value instanceof Uint8Array && value.byteLength === PASSKEY_PRF_INPUT_BYTES;
}

function classifyWebAuthnFailure(cause: unknown): CodedFailure<PasskeyPrfErrorCode> {
  if (cause instanceof DOMException) {
    if (cause.name === "NotAllowedError" || cause.name === "AbortError") {
      return { code: "credential_cancelled", cause };
    }
    if (cause.name === "NotSupportedError" || cause.name === "SecurityError") {
      return { code: "webauthn_unavailable", cause };
    }
  }
  return { code: "webauthn_failed", cause };
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
