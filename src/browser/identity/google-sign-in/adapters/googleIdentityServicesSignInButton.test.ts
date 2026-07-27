/** @vitest-environment jsdom */

import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { encodeBase64Url } from "../../../../libs/encoding/base64Url";
import type { GoogleAccounts, GoogleCredentialResponse } from "../../google-identity-services/application/googleIdentityServices";
import {
  bindGoogleCredentialCallback,
  GoogleIdentityServicesSignInButton,
  readUnverifiedGoogleIdTokenSubject,
  releaseGoogleCredentialCallback,
} from "./googleIdentityServicesSignInButton";

const maximumGoogleIdTokenCharacters = 16 * 1024 - '{"googleIdToken":""}'.length;

describe("Google credential callback ownership", () => {
  it("keeps one live owner and never dispatches to a rejected binding", () => {
    let dispatch: ((response: GoogleCredentialResponse) => void) | undefined;
    const accounts = googleAccounts();
    accounts.id.initialize = vi.fn((config) => { dispatch = config.callback; });
    const first = vi.fn();
    const second = vi.fn();

    expect(Result.isError(bindGoogleCredentialCallback({ accounts, clientId: "google-client", callback: first }))).toBe(false);
    expect(Result.isError(bindGoogleCredentialCallback({ accounts, clientId: "google-client", callback: second }))).toBe(true);
    dispatch?.({ credential: "first-credential" });
    expect(first).toHaveBeenCalledWith({ credential: "first-credential" });
    expect(second).not.toHaveBeenCalled();

    releaseGoogleCredentialCallback(second);
    dispatch?.({ credential: "still-first" });
    expect(first).toHaveBeenCalledWith({ credential: "still-first" });

    releaseGoogleCredentialCallback(first);
    expect(Result.isError(bindGoogleCredentialCallback({ accounts, clientId: "google-client", callback: second }))).toBe(false);
    expect(Result.isError(bindGoogleCredentialCallback({ accounts, clientId: "different-client", callback: first }))).toBe(true);
    dispatch?.({ credential: "second-credential" });
    expect(second).toHaveBeenCalledWith({ credential: "second-credential" });
    releaseGoogleCredentialCallback(second);
  });
});

describe("readUnverifiedGoogleIdTokenSubject", () => {
  it("reads a subject from a canonical Base64url payload", () => {
    const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ sub: "google-subject" })));

    expect(readUnverifiedGoogleIdTokenSubject(`header.${payload}.signature`)).toBe("google-subject");
  });

  it("rejects malformed and non-canonical payloads", () => {
    expect(readUnverifiedGoogleIdTokenSubject("header.A.signature")).toBeUndefined();
    expect(readUnverifiedGoogleIdTokenSubject("header.AB.signature")).toBeUndefined();
  });

  it("rejects malformed JWT segment counts and empty segments", () => {
    const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ sub: "google-subject" })));

    expect(readUnverifiedGoogleIdTokenSubject(`header.${payload}`)).toBeUndefined();
    expect(readUnverifiedGoogleIdTokenSubject(`header.${payload}.signature.extra`)).toBeUndefined();
    expect(readUnverifiedGoogleIdTokenSubject(`.${payload}.signature`)).toBeUndefined();
    expect(readUnverifiedGoogleIdTokenSubject(`header.${payload}.`)).toBeUndefined();
  });

  it("rejects oversized tokens and decoded payloads", () => {
    const oversizedPayload = encodeBase64Url(new Uint8Array(8 * 1024 + 1));

    expect(readUnverifiedGoogleIdTokenSubject("a".repeat(maximumGoogleIdTokenCharacters + 1))).toBeUndefined();
    expect(readUnverifiedGoogleIdTokenSubject(`header.${oversizedPayload}.signature`)).toBeUndefined();
  });

  it("rejects empty and oversized subjects", () => {
    const tokenFor = (subject: string) => {
      const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ sub: subject })));
      return `header.${payload}.signature`;
    };

    expect(readUnverifiedGoogleIdTokenSubject(tokenFor("   "))).toBeUndefined();
    expect(readUnverifiedGoogleIdTokenSubject(tokenFor("s".repeat(256)))).toBeUndefined();
  });

  it("rejects malformed UTF-8 payloads", () => {
    const prefix = new TextEncoder().encode('{"sub":"');
    const suffix = new TextEncoder().encode('"}');
    const malformedJson = new Uint8Array(prefix.length + 1 + suffix.length);
    malformedJson.set(prefix);
    malformedJson[prefix.length] = 0xff;
    malformedJson.set(suffix, prefix.length + 1);

    expect(readUnverifiedGoogleIdTokenSubject(`header.${encodeBase64Url(malformedJson)}.signature`)).toBeUndefined();
  });
});

describe("GoogleIdentityServicesSignInButton", () => {
  it("owns GIS rendering and emits only a validated credential", async () => {
    let providerCallback: ((response: GoogleCredentialResponse) => void) | undefined;
    const accounts = googleAccounts();
    const target = document.createElement("div");
    const onCredential = vi.fn();
    const widget = new GoogleIdentityServicesSignInButton({
      clientId: "google-client",
      googleIdentityServices: { loadGoogleAccounts: vi.fn(async () => Result.ok(accounts)) },
      dependencies: {
        bindGoogleCredentialCallback: vi.fn((input) => {
          providerCallback = input.callback;
          return Result.ok();
        }),
        releaseGoogleCredentialCallback: vi.fn(),
        readUnverifiedGoogleIdTokenSubject: vi.fn(() => "google-subject"),
      },
    });

    await expect(widget.mount({ target, onCredential })).resolves.toEqual(Result.ok());
    expect(accounts.id.renderButton).toHaveBeenCalledWith(target, {
      theme: "outline",
      size: "large",
      text: "continue_with",
    });

    providerCallback?.({ credential: "google-id-token" });
    expect(onCredential).toHaveBeenCalledWith(Result.ok({
      googleIdToken: "google-id-token",
      subject: "google-subject",
    }));
  });

  it("maps malformed credentials without exposing provider values", async () => {
    let providerCallback: ((response: GoogleCredentialResponse) => void) | undefined;
    const onCredential = vi.fn();
    const widget = new GoogleIdentityServicesSignInButton({
      clientId: "google-client",
      googleIdentityServices: { loadGoogleAccounts: vi.fn(async () => Result.ok(googleAccounts())) },
      dependencies: {
        bindGoogleCredentialCallback: vi.fn((input) => {
          providerCallback = input.callback;
          return Result.ok();
        }),
        releaseGoogleCredentialCallback: vi.fn(),
        readUnverifiedGoogleIdTokenSubject: vi.fn(() => undefined),
      },
    });
    await widget.mount({ target: document.createElement("div"), onCredential });

    providerCallback?.({ credential: "invalid-token" });

    const credentialResult = onCredential.mock.calls[0]?.[0];
    expect(Result.isError(credentialResult)).toBe(true);
    if (Result.isError(credentialResult)) expect(credentialResult.error).toEqual({ code: "sign_in_failed" });
    expect(JSON.stringify(onCredential.mock.calls)).not.toContain("invalid-token");
  });

  it("rejects oversized credentials before decoding or retaining them", async () => {
    let providerCallback: ((response: GoogleCredentialResponse) => void) | undefined;
    const onCredential = vi.fn();
    const readUnverifiedGoogleIdTokenSubject = vi.fn(() => "google-subject");
    const widget = new GoogleIdentityServicesSignInButton({
      clientId: "google-client",
      googleIdentityServices: { loadGoogleAccounts: vi.fn(async () => Result.ok(googleAccounts())) },
      dependencies: {
        bindGoogleCredentialCallback: vi.fn((input) => {
          providerCallback = input.callback;
          return Result.ok();
        }),
        releaseGoogleCredentialCallback: vi.fn(),
        readUnverifiedGoogleIdTokenSubject,
      },
    });
    await widget.mount({ target: document.createElement("div"), onCredential });

    providerCallback?.({ credential: "a".repeat(maximumGoogleIdTokenCharacters + 1) });

    expect(readUnverifiedGoogleIdTokenSubject).not.toHaveBeenCalled();
    const credentialResult = onCredential.mock.calls[0]?.[0];
    expect(Result.isError(credentialResult)).toBe(true);
    if (Result.isError(credentialResult)) expect(credentialResult.error).toEqual({ code: "sign_in_failed" });
  });

  it("releases callback ownership when rendering fails", async () => {
    const releaseGoogleCredentialCallback = vi.fn();
    const accounts = googleAccounts();
    accounts.id.renderButton = vi.fn(() => { throw new Error("render failed"); });
    const widget = new GoogleIdentityServicesSignInButton({
      clientId: "google-client",
      googleIdentityServices: { loadGoogleAccounts: vi.fn(async () => Result.ok(accounts)) },
      dependencies: {
        bindGoogleCredentialCallback: vi.fn(() => Result.ok()),
        releaseGoogleCredentialCallback,
        readUnverifiedGoogleIdTokenSubject: vi.fn(() => "google-subject"),
      },
    });

    const result = await widget.mount({ target: document.createElement("div"), onCredential: vi.fn() });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "google_unavailable" });
    expect(releaseGoogleCredentialCallback).toHaveBeenCalledOnce();
  });
});

function googleAccounts(): GoogleAccounts {
  return {
    id: { initialize: vi.fn(), renderButton: vi.fn() },
    oauth2: { initTokenClient: vi.fn() },
  };
}
