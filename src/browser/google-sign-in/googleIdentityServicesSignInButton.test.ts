/** @vitest-environment jsdom */

import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { encodeBase64Url } from "../../libs/encoding/base64Url";
import {
  GoogleIdentityServices,
  type GoogleAccounts,
  type GoogleCredentialResponse,
} from "../google-identity-services/googleIdentityServices";
import {
  bindGoogleCredentialCallback,
  GoogleIdentityServicesSignInButton,
  readUnverifiedGoogleIdTokenSubject,
  releaseGoogleCredentialCallback,
} from "./googleIdentityServicesSignInButton";

const MAXIMUM_GOOGLE_ID_TOKEN_CHARACTERS = 16 * 1024 - '{"googleIdToken":""}'.length;
const GOOGLE_SUBJECT_CANARY = "google-subject";

describe("Google credential callback ownership", () => {
  it("keeps one live owner and never dispatches to a rejected binding", () => {
    let dispatch: ((response: GoogleCredentialResponse) => void) | undefined;
    const accounts = googleAccounts();
    accounts.id.initialize = vi.fn((config) => { dispatch = config.callback; });
    const first = credentialResponseRecorder();
    const second = credentialResponseRecorder();

    expect(Result.isError(bindGoogleCredentialCallback(accounts, "google-client", first))).toBe(false);
    expect(Result.isError(bindGoogleCredentialCallback(accounts, "google-client", second))).toBe(true);
    dispatch?.({ credential: "first-credential" });
    expect(first.record).toEqual({ calls: 1, credentialPresent: true });
    expect(second.record.calls).toBe(0);

    releaseGoogleCredentialCallback(second);
    dispatch?.({ credential: "still-first" });
    expect(first.record).toEqual({ calls: 2, credentialPresent: true });

    releaseGoogleCredentialCallback(first);
    expect(Result.isError(bindGoogleCredentialCallback(accounts, "google-client", second))).toBe(false);
    expect(Result.isError(bindGoogleCredentialCallback(accounts, "different-client", first))).toBe(true);
    dispatch?.({ credential: "second-credential" });
    expect(second.record).toEqual({ calls: 1, credentialPresent: true });
    expect(JSON.stringify({ first: first.record, second: second.record })).not.toContain("second-credential");
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

    expect(readUnverifiedGoogleIdTokenSubject("a".repeat(MAXIMUM_GOOGLE_ID_TOKEN_CHARACTERS + 1))).toBeUndefined();
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
    accounts.id.initialize = vi.fn((config) => { providerCallback = config.callback; });
    const target = document.createElement("div");
    const onCredential = credentialResultRecorder();
    const widget = new GoogleIdentityServicesSignInButton({
      clientId: "google-client",
      googleIdentityServices: googleIdentityServicesFor(accounts),
    });

    await expect(widget.mount(target, onCredential)).resolves.toEqual(Result.ok());
    expect(accounts.id.renderButton).toHaveBeenCalledWith(target, {
      theme: "outline",
      size: "large",
      text: "continue_with",
    });

    providerCallback?.({ credential: googleIdToken(GOOGLE_SUBJECT_CANARY) });
    expect(onCredential.record).toEqual({ calls: 1, ok: true, tokenPresent: true, subjectPresent: true, matchesExpectedSubject: true });
    expect(JSON.stringify(onCredential.record)).not.toContain(GOOGLE_SUBJECT_CANARY);
    widget.unmount();
  });

  it("maps malformed credentials without exposing provider values", async () => {
    let providerCallback: ((response: GoogleCredentialResponse) => void) | undefined;
    const onCredential = credentialResultRecorder();
    const accounts = googleAccounts();
    accounts.id.initialize = vi.fn((config) => { providerCallback = config.callback; });
    const widget = new GoogleIdentityServicesSignInButton({
      clientId: "google-client",
      googleIdentityServices: googleIdentityServicesFor(accounts),
    });
    await widget.mount(document.createElement("div"), onCredential);

    providerCallback?.({ credential: "invalid-token" });

    expect(onCredential.record).toEqual({ calls: 1, ok: false, code: "sign_in_failed" });
    expect(JSON.stringify(onCredential.record)).not.toContain("invalid-token");
    widget.unmount();
  });

  it("rejects oversized credentials before decoding or retaining them", async () => {
    let providerCallback: ((response: GoogleCredentialResponse) => void) | undefined;
    const onCredential = credentialResultRecorder();
    const accounts = googleAccounts();
    accounts.id.initialize = vi.fn((config) => { providerCallback = config.callback; });
    const widget = new GoogleIdentityServicesSignInButton({
      clientId: "google-client",
      googleIdentityServices: googleIdentityServicesFor(accounts),
    });
    await widget.mount(document.createElement("div"), onCredential);

    providerCallback?.({ credential: "a".repeat(MAXIMUM_GOOGLE_ID_TOKEN_CHARACTERS + 1) });

    expect(onCredential.record).toEqual({ calls: 1, ok: false, code: "sign_in_failed" });
    widget.unmount();
  });

  it("releases callback ownership when rendering fails", async () => {
    const accounts = googleAccounts();
    accounts.id.renderButton = vi.fn(() => { throw new Error("render failed"); });
    const widget = new GoogleIdentityServicesSignInButton({
      clientId: "google-client",
      googleIdentityServices: googleIdentityServicesFor(accounts),
    });

    const result = await widget.mount(document.createElement("div"), vi.fn());

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "google_unavailable" });
    const replacement = vi.fn();
    expect(Result.isError(bindGoogleCredentialCallback(accounts, "google-client", replacement))).toBe(false);
    releaseGoogleCredentialCallback(replacement);
  });
});

function googleAccounts(): GoogleAccounts {
  return {
    id: { initialize: vi.fn(), renderButton: vi.fn() },
    oauth2: { initTokenClient: vi.fn() },
  };
}

function googleIdentityServicesFor(accounts: GoogleAccounts): GoogleIdentityServices {
  const googleIdentityServices = new GoogleIdentityServices();
  vi.spyOn(googleIdentityServices, "loadGoogleAccounts").mockResolvedValue(Result.ok(accounts));
  return googleIdentityServices;
}

function credentialResponseRecorder() {
  const record = { calls: 0, credentialPresent: false };
  const callback = (response: GoogleCredentialResponse) => {
    record.calls += 1;
    record.credentialPresent = typeof response.credential === "string" && response.credential.length > 0;
  };
  return Object.assign(callback, { record });
}

function credentialResultRecorder() {
  const record: { calls: number; ok?: boolean; tokenPresent?: boolean; subjectPresent?: boolean; matchesExpectedSubject?: boolean; code?: string } = { calls: 0 };
  const callback: Parameters<GoogleIdentityServicesSignInButton["mount"]>[1] = (result) => {
    record.calls += 1;
    record.ok = Result.isOk(result);
    if (Result.isError(result)) {
      record.code = result.error.code;
    } else {
      record.tokenPresent = result.value.googleIdToken.length > 0;
      record.subjectPresent = result.value.subject.length > 0;
      record.matchesExpectedSubject = result.value.subject === GOOGLE_SUBJECT_CANARY;
    }
  };
  return Object.assign(callback, { record });
}

function googleIdToken(subject: string): string {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ sub: subject })));
  return `header.${payload}.signature`;
}
