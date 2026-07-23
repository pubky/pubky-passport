import "client-only";

import { Result } from "better-result";

import { logger } from "../../../libs/logger/logger";
import type {
  GoogleSignInCredential,
  GoogleSignInWidgetPort,
  GoogleSignInWidgetResult,
} from "../browserIdentityControllerInternals";
import type { GoogleIdentityProviderResult } from "./applicationContracts";
import type {
  GoogleAccounts,
  GoogleCredentialResponse,
} from "./googleIdentityProviderTypes";
import {
  bindGoogleCredentialCallback,
  googleIdTokenSubject,
  loadGoogleAccounts,
  releaseGoogleCredentialCallback,
} from "./googleIdentityProvider";

type GoogleSignInWidgetDependencies = {
  loadGoogleAccounts(): Promise<GoogleIdentityProviderResult<GoogleAccounts>>;
  bindGoogleCredentialCallback(input: {
    accounts: GoogleAccounts;
    clientId: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): GoogleIdentityProviderResult<void>;
  releaseGoogleCredentialCallback(callback: (response: GoogleCredentialResponse) => void): void;
  googleIdTokenSubject(token: string): string | undefined;
};

const defaultDependencies: GoogleSignInWidgetDependencies = {
  loadGoogleAccounts,
  bindGoogleCredentialCallback,
  releaseGoogleCredentialCallback,
  googleIdTokenSubject,
};

export class GoogleSignInWidget implements GoogleSignInWidgetPort {
  readonly #clientId: string;
  readonly #dependencies: GoogleSignInWidgetDependencies;
  #credentialCallback: ((response: GoogleCredentialResponse) => void) | null = null;
  #attempt = 0;

  constructor(input: {
    clientId: string;
    dependencies?: GoogleSignInWidgetDependencies;
  }) {
    this.#clientId = input.clientId;
    this.#dependencies = input.dependencies ?? defaultDependencies;
  }

  async mount(input: {
    target: HTMLElement;
    onCredential: (result: GoogleSignInWidgetResult<GoogleSignInCredential>) => void;
  }): Promise<GoogleSignInWidgetResult<void>> {
    this.unmount();
    const activeAttempt = ++this.#attempt;
    let accounts: GoogleIdentityProviderResult<GoogleAccounts>;
    try {
      accounts = await this.#dependencies.loadGoogleAccounts();
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
        const subject = this.#dependencies.googleIdTokenSubject(response.credential);
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
    let bound: GoogleIdentityProviderResult<void>;
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

  private unavailable(code: string): GoogleSignInWidgetResult<never> {
    logger.warn("identity.google.button.unavailable", { code });
    this.unmount();
    return Result.err({ code: "google_unavailable" });
  }
}
