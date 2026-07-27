import "client-only";

import { Result } from "better-result";

import { decodeBase64Url } from "../../../../libs/encoding/base64Url";

import { logger } from "../../../../libs/logger/logger";
import type {
  GoogleSignInCredential,
  GoogleSignInButton,
  GoogleSignInResult,
} from "../application/googleSignIn";
import type {
  GoogleAccounts,
  GoogleCredentialResponse,
  GoogleIdentityServicesLoader,
} from "../../google-identity-services/application/googleIdentityServices";

type GoogleSignInButtonDependencies = {
  bindGoogleCredentialCallback(input: {
    accounts: GoogleAccounts;
    clientId: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): GoogleSignInResult<void>;
  releaseGoogleCredentialCallback(callback: (response: GoogleCredentialResponse) => void): void;
  readUnverifiedGoogleIdTokenSubject(token: string): string | undefined;
};

const defaultDependencies: GoogleSignInButtonDependencies = {
  bindGoogleCredentialCallback,
  releaseGoogleCredentialCallback,
  readUnverifiedGoogleIdTokenSubject,
};

export class GoogleIdentityServicesSignInButton implements GoogleSignInButton {
  readonly #clientId: string;
  readonly #googleIdentityServices: GoogleIdentityServicesLoader;
  readonly #dependencies: GoogleSignInButtonDependencies;
  #credentialCallback: ((response: GoogleCredentialResponse) => void) | null = null;
  #attempt = 0;

  constructor(input: {
    clientId: string;
    googleIdentityServices: GoogleIdentityServicesLoader;
    dependencies?: GoogleSignInButtonDependencies;
  }) {
    this.#clientId = input.clientId;
    this.#googleIdentityServices = input.googleIdentityServices;
    this.#dependencies = input.dependencies ?? defaultDependencies;
  }

  async mount(input: {
    target: HTMLElement;
    onCredential: (result: GoogleSignInResult<GoogleSignInCredential>) => void;
  }): Promise<GoogleSignInResult<void>> {
    this.unmount();
    const activeAttempt = ++this.#attempt;
    let accounts: Awaited<ReturnType<GoogleIdentityServicesLoader["loadGoogleAccounts"]>>;
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
        if (typeof response.credential !== "string" || response.credential.length === 0) {
          logger.warn("identity.google.button.credential_failed");
          input.onCredential(Result.err({ code: "sign_in_failed" }));
          return;
        }
        const subject = this.#dependencies.readUnverifiedGoogleIdTokenSubject(response.credential);
        if (!subject) {
          input.onCredential(Result.err({ code: "sign_in_failed" }));
          return;
        }
        input.onCredential(Result.ok({ googleIdToken: response.credential, subject }));
      } catch {
        logger.warn("identity.google.button.credential_failed", { code: "unexpected" });
        input.onCredential(Result.err({ code: "sign_in_failed" }));
      }
    };

    this.#credentialCallback = callback;
    let bound: GoogleSignInResult<void>;
    try {
      bound = this.#dependencies.bindGoogleCredentialCallback({
        accounts: accounts.value,
        clientId: this.#clientId,
        callback,
      });
    } catch {
      return this.unavailable("bind_threw");
    }
    if (Result.isError(bound)) return this.unavailable(bound.error.code);

    try {
      input.target.replaceChildren();
      accounts.value.id.renderButton(input.target, {
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
      this.#dependencies.releaseGoogleCredentialCallback(this.#credentialCallback);
    } catch {
      logger.warn("identity.google.cleanup.failed", { operation: "credential_release" });
    }
    this.#credentialCallback = null;
  }

  private unavailable(code: string): GoogleSignInResult<never> {
    logger.warn("identity.google.button.unavailable", { code });
    this.unmount();
    return Result.err({ code: "google_unavailable" });
  }
}

let initializedIdentityAccounts: GoogleAccounts | undefined;
let initializedIdentityClientId: string | undefined;
let activeCredentialCallback: ((response: GoogleCredentialResponse) => void) | undefined;

export function bindGoogleCredentialCallback(input: {
  accounts: GoogleAccounts;
  clientId: string;
  callback: (response: GoogleCredentialResponse) => void;
}): GoogleSignInResult<void> {
  if (activeCredentialCallback && activeCredentialCallback !== input.callback) {
    return Result.err({ code: "sign_in_failed" });
  }
  if (initializedIdentityAccounts === input.accounts) {
    if (initializedIdentityClientId !== input.clientId) return Result.err({ code: "sign_in_failed" });
    activeCredentialCallback = input.callback;
    return Result.ok();
  }
  if (activeCredentialCallback) return Result.err({ code: "sign_in_failed" });

  activeCredentialCallback = input.callback;
  try {
    input.accounts.id.initialize({
      client_id: input.clientId,
      auto_select: false,
      callback(response) { activeCredentialCallback?.(response); },
    });
    initializedIdentityAccounts = input.accounts;
    initializedIdentityClientId = input.clientId;
    return Result.ok();
  } catch {
    if (activeCredentialCallback === input.callback) activeCredentialCallback = undefined;
    return Result.err({ code: "sign_in_failed" });
  }
}

export function releaseGoogleCredentialCallback(callback: (response: GoogleCredentialResponse) => void): void {
  if (activeCredentialCallback === callback) activeCredentialCallback = undefined;
}

export function readUnverifiedGoogleIdTokenSubject(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const bytes = decodeBase64Url(payload);
    if (!bytes) return undefined;
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null && "sub" in value && typeof value.sub === "string"
      ? value.sub
      : undefined;
  } catch {
    return undefined;
  }
}
