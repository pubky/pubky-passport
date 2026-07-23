/** @vitest-environment jsdom */

import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import type { GoogleAccounts, GoogleCredentialResponse } from "./googleIdentityProviderTypes";
import { GoogleSignInWidget } from "./googleSignInWidget";

describe("GoogleSignInWidget", () => {
  it("owns GIS rendering and emits only a validated credential", async () => {
    let providerCallback: ((response: GoogleCredentialResponse) => void) | undefined;
    const accounts = googleAccounts();
    const target = document.createElement("div");
    const onCredential = vi.fn();
    const widget = new GoogleSignInWidget({
      clientId: "google-client",
      dependencies: {
        loadGoogleAccounts: vi.fn(async () => Result.ok(accounts)),
        bindGoogleCredentialCallback: vi.fn((input) => {
          providerCallback = input.callback;
          return Result.ok();
        }),
        releaseGoogleCredentialCallback: vi.fn(),
        googleIdTokenSubject: vi.fn(() => "google-subject"),
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
    const widget = new GoogleSignInWidget({
      clientId: "google-client",
      dependencies: {
        loadGoogleAccounts: vi.fn(async () => Result.ok(googleAccounts())),
        bindGoogleCredentialCallback: vi.fn((input) => {
          providerCallback = input.callback;
          return Result.ok();
        }),
        releaseGoogleCredentialCallback: vi.fn(),
        googleIdTokenSubject: vi.fn(() => undefined),
      },
    });
    await widget.mount({ target: document.createElement("div"), onCredential });

    providerCallback?.({ credential: "invalid-token" });

    const credentialResult = onCredential.mock.calls[0]?.[0];
    expect(Result.isError(credentialResult)).toBe(true);
    if (Result.isError(credentialResult)) expect(credentialResult.error).toEqual({ code: "sign_in_failed" });
    expect(JSON.stringify(onCredential.mock.calls)).not.toContain("invalid-token");
  });

  it("releases callback ownership when rendering fails", async () => {
    const releaseGoogleCredentialCallback = vi.fn();
    const accounts = googleAccounts();
    accounts.id.renderButton = vi.fn(() => { throw new Error("render failed"); });
    const widget = new GoogleSignInWidget({
      clientId: "google-client",
      dependencies: {
        loadGoogleAccounts: vi.fn(async () => Result.ok(accounts)),
        bindGoogleCredentialCallback: vi.fn(() => Result.ok()),
        releaseGoogleCredentialCallback,
        googleIdTokenSubject: vi.fn(() => "google-subject"),
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
