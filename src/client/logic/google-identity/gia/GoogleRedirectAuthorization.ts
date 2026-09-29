import "client-only";

import { Result } from "better-result";

import { encodeBase64Url } from "@/libs/encoding/base64Url";
import { GOOGLE_REDIRECT_STORAGE_KEY } from "@/libs/authorization/googleRedirectConstants";
import { AUTHORIZATION_TIMEOUT_MS } from "@/libs/passportPolicy";
import {
  getGoogleRedirectContext,
  type GoogleRedirectAttempt,
  type GoogleRedirectOperation,
} from "./googleRedirectBootstrap";
import type {
  GoogleIdentityCredentials,
  GoogleImplicitAuthorizationResult,
} from "./GoogleImplicitAuthorization";
import { GOOGLE_AUTHORIZATION_SCOPE } from "./parseGoogleAuthorizationResponse";
import { resolveGoogleCredentials } from "./resolveGoogleCredentials";

/** Same-tab transport used only while establishing an identity for /authorize. */
export class GoogleRedirectAuthorization {
  private readonly abortController = new AbortController();
  private readonly context = getGoogleRedirectContext();
  private response = this.context?.response;
  private continuation = this.response?.attempt;
  private settleNavigation:
    ((result: GoogleImplicitAuthorizationResult<GoogleIdentityCredentials>) => void) | undefined;

  constructor(
    private readonly clientId: string,
    private readonly appWindow: Window = window,
  ) {
    // The response belongs to one controller, even if a setup screen remounts.
    if (this.context) delete this.context.response;
  }

  takeContinuation(): GoogleRedirectOperation | undefined {
    const continuation = this.continuation;
    this.continuation = undefined;
    return continuation;
  }

  async request(
    operation: GoogleRedirectOperation,
  ): Promise<GoogleImplicitAuthorizationResult<GoogleIdentityCredentials>> {
    if (this.abortController.signal.aborted || !this.context?.request.isLive()) {
      return Result.err({ code: "google_authorization_failed" });
    }
    const response = this.response;
    this.response = undefined;
    if (response) {
      if (Date.now() >= response.attempt.expiresAt)
        return Result.err({ code: "google_authorization_failed" });
      return resolveGoogleCredentials(
        response.capture,
        response.attempt.state,
        response.attempt.nonce,
        this.abortController.signal,
      );
    }
    const requestUrl = this.context.request.validatedUrlForApproval();
    if (!requestUrl) return Result.err({ code: "google_authorization_failed" });
    try {
      const attempt: GoogleRedirectAttempt = {
        ...operation,
        version: 1,
        requestUrl,
        state: encodeBase64Url(crypto.getRandomValues(new Uint8Array(32))),
        nonce: encodeBase64Url(crypto.getRandomValues(new Uint8Array(32))),
        expiresAt: Date.now() + AUTHORIZATION_TIMEOUT_MS,
      };
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: this.clientId,
        response_type: "id_token token",
        scope: GOOGLE_AUTHORIZATION_SCOPE,
        redirect_uri: this.appWindow.location.origin,
        state: attempt.state,
        nonce: attempt.nonce,
        prompt: "consent",
        include_granted_scopes: "false",
        ...(operation.googleSubject ? { login_hint: operation.googleSubject } : {}),
      }).toString();
      const serialized = JSON.stringify(attempt);
      this.appWindow.sessionStorage.setItem(GOOGLE_REDIRECT_STORAGE_KEY, serialized);
      if (this.appWindow.sessionStorage.getItem(GOOGLE_REDIRECT_STORAGE_KEY) !== serialized)
        throw new Error("Redirect storage unavailable");
      this.appWindow.location.replace(url.href);
      // Navigation destroys this document. Disposal settles the operation if it runs first.
      return await new Promise((resolve) => {
        this.settleNavigation = resolve;
      });
    } catch {
      try {
        this.appWindow.sessionStorage.removeItem(GOOGLE_REDIRECT_STORAGE_KEY);
      } catch {
        /* Storage may be blocked. */
      }
      return Result.err({ code: "google_authorization_failed" });
    }
  }

  dispose(): void {
    this.response = undefined;
    this.continuation = undefined;
    this.abortController.abort();
    this.settleNavigation?.(Result.err({ code: "google_authorization_failed" }));
    this.settleNavigation = undefined;
    // Keep the pending metadata through pagehide so Google's return can resume it.
  }
}
