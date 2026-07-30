import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { decodeBase64Url } from "../../libs/encoding/base64Url";

import { LOGGER } from "../../libs/logger/logger";
import type {
  GoogleAccounts,
  GoogleCredentialResponse,
  GoogleIdentityServices,
} from "../google-identity-services/googleIdentityServices";

export type GoogleSignInCredential = {
  googleIdToken: string;
  subject: string;
};

export type GoogleSignInErrorCode = "google_unavailable" | "sign_in_failed";
export type GoogleSignInResult<T> = ResultType<T, { code: GoogleSignInErrorCode }>;

const GOOGLE_ID_TOKEN_REQUEST_ENVELOPE_CHARACTERS = '{"googleIdToken":""}'.length;
const MAXIMUM_GOOGLE_ID_TOKEN_CHARACTERS = 16 * 1024 - GOOGLE_ID_TOKEN_REQUEST_ENVELOPE_CHARACTERS;
const MAXIMUM_GOOGLE_ID_TOKEN_PAYLOAD_BYTES = 8 * 1024;
const MAXIMUM_GOOGLE_SUBJECT_CHARACTERS = 255;
const BASE64_URL_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

export class GoogleIdentityServicesSignInButton {
  readonly #clientId: string;
  readonly #googleIdentityServices: GoogleIdentityServices;
  #credentialCallback: ((response: GoogleCredentialResponse) => void) | null = null;
  #attempt = 0;

  constructor(input: {
    clientId: string;
    googleIdentityServices: GoogleIdentityServices;
  }) {
    this.#clientId = input.clientId;
    this.#googleIdentityServices = input.googleIdentityServices;
  }

  async mount(
    target: HTMLElement,
    onCredential: (result: GoogleSignInResult<GoogleSignInCredential>) => void,
  ): Promise<GoogleSignInResult<void>> {
    this.unmount();
    const activeAttempt = ++this.#attempt;
    let accounts: Awaited<ReturnType<GoogleIdentityServices["loadGoogleAccounts"]>>;
    try {
      accounts = await this.#googleIdentityServices.loadGoogleAccounts();
    } catch {
      return this.unavailable("load_threw");
    }
    if (activeAttempt !== this.#attempt) return Result.err({ code: "sign_in_failed" });
    if (Result.isError(accounts)) return this.unavailable(accounts.error.code);

    const callback = (response: GoogleCredentialResponse): void => {
      if (activeAttempt !== this.#attempt) return;
      try {
        if (
          typeof response.credential !== "string"
          || response.credential.length === 0
          || response.credential.length > MAXIMUM_GOOGLE_ID_TOKEN_CHARACTERS
        ) {
          LOGGER.warn("identity.google.button.credential_failed");
          onCredential(Result.err({ code: "sign_in_failed" }));
          return;
        }
        const subject = readUnverifiedGoogleIdTokenSubject(response.credential);
        if (!subject) {
          onCredential(Result.err({ code: "sign_in_failed" }));
          return;
        }
        onCredential(Result.ok({ googleIdToken: response.credential, subject }));
      } catch {
        LOGGER.warn("identity.google.button.credential_failed", { code: "unexpected" });
        onCredential(Result.err({ code: "sign_in_failed" }));
      }
    };

    this.#credentialCallback = callback;
    let bound: GoogleSignInResult<void>;
    try {
      bound = bindGoogleCredentialCallback(accounts.value, this.#clientId, callback);
    } catch {
      return this.unavailable("bind_threw");
    }
    if (Result.isError(bound)) return this.unavailable(bound.error.code);

    try {
      target.replaceChildren();
      accounts.value.id.renderButton(target, {
        theme: "outline",
        size: "large",
        text: "continue_with",
      });
      return Result.ok();
    } catch {
      return this.unavailable("render_failed");
    }
  }

  unmount(): void {
    this.#attempt += 1;
    if (!this.#credentialCallback) return;
    try {
      releaseGoogleCredentialCallback(this.#credentialCallback);
    } catch {
      LOGGER.warn("identity.google.cleanup.failed", { operation: "credential_release" });
    }
    this.#credentialCallback = null;
  }

  private unavailable(code: string): GoogleSignInResult<never> {
    LOGGER.warn("identity.google.button.unavailable", { code });
    this.unmount();
    return Result.err({ code: "google_unavailable" });
  }
}

let initializedIdentityAccounts: GoogleAccounts | undefined;
let initializedIdentityClientId: string | undefined;
let activeCredentialCallback: ((response: GoogleCredentialResponse) => void) | undefined;

export function bindGoogleCredentialCallback(
  accounts: GoogleAccounts,
  clientId: string,
  callback: (response: GoogleCredentialResponse) => void,
): GoogleSignInResult<void> {
  if (activeCredentialCallback && activeCredentialCallback !== callback) {
    return Result.err({ code: "sign_in_failed" });
  }
  if (initializedIdentityAccounts === accounts) {
    if (initializedIdentityClientId !== clientId) return Result.err({ code: "sign_in_failed" });
    activeCredentialCallback = callback;
    return Result.ok();
  }
  if (activeCredentialCallback) return Result.err({ code: "sign_in_failed" });

  activeCredentialCallback = callback;
  try {
    accounts.id.initialize({
      client_id: clientId,
      auto_select: false,
      callback(response) { activeCredentialCallback?.(response); },
    });
    initializedIdentityAccounts = accounts;
    initializedIdentityClientId = clientId;
    return Result.ok();
  } catch {
    if (activeCredentialCallback === callback) activeCredentialCallback = undefined;
    return Result.err({ code: "sign_in_failed" });
  }
}

export function releaseGoogleCredentialCallback(callback: (response: GoogleCredentialResponse) => void): void {
  if (activeCredentialCallback === callback) activeCredentialCallback = undefined;
}

export function readUnverifiedGoogleIdTokenSubject(token: string): string | undefined {
  if (token.length === 0 || token.length > MAXIMUM_GOOGLE_ID_TOKEN_CHARACTERS) return undefined;

  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => !BASE64_URL_SEGMENT_PATTERN.test(segment))) {
    return undefined;
  }

  const payload = segments[1];
  if (!payload) return undefined;
  try {
    const bytes = decodeBase64Url(payload);
    if (!bytes || bytes.byteLength > MAXIMUM_GOOGLE_ID_TOKEN_PAYLOAD_BYTES) return undefined;
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "sub")) {
      return undefined;
    }

    const subject = (value as Record<string, unknown>).sub;
    return typeof subject === "string"
      && subject.length <= MAXIMUM_GOOGLE_SUBJECT_CHARACTERS
      && subject.trim().length > 0
      ? subject
      : undefined;
  } catch {
    return undefined;
  }
}
