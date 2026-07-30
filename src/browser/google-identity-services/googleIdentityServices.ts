import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../libs/logger/logger";

export type GoogleIdentityServicesResult<T> = ResultType<T, { code: "google_unavailable" }>;

export type GoogleCredentialResponse = { credential?: unknown };
export type GoogleTokenResponse = { access_token?: unknown; error?: unknown; scope?: unknown };
export type GoogleOAuthError = { type?: unknown };

export type GoogleAccounts = {
  id: {
    initialize(config: { client_id: string; callback: (response: GoogleCredentialResponse) => void; auto_select: boolean }): void;
    renderButton(parent: HTMLElement, config: { theme: "outline"; size: "large"; text: "continue_with" | "signin_with" }): void;
    disableAutoSelect?(): void;
  };
  oauth2: {
    initTokenClient(config: {
      client_id: string;
      scope: string;
      login_hint?: string;
      callback: (response: GoogleTokenResponse) => void;
      error_callback: (error: GoogleOAuthError) => void;
    }): { requestAccessToken(input: { prompt: "" | "consent" | "select_account" }): void };
  };
};

declare global {
  interface Window {
    google?: { accounts?: GoogleAccounts };
  }
}

const GOOGLE_GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const GIS_SCRIPT_LOAD_TIMEOUT_MS = 10_000;
const GIS_LOAD_STATE_ATTRIBUTE = "data-pubky-passport-load-state";

export class GoogleIdentityServices {
  static #scriptLoadPromise: Promise<void> | undefined;
  readonly #document: Document;
  readonly #timeoutMs: number;

  constructor(options: { document?: Document; timeoutMs?: number } = {}) {
    this.#document = options.document ?? globalThis.document;
    this.#timeoutMs = options.timeoutMs ?? GIS_SCRIPT_LOAD_TIMEOUT_MS;
  }

  async loadGoogleAccounts(): Promise<GoogleIdentityServicesResult<GoogleAccounts>> {
    const existing = globalThis.window.google?.accounts;
    if (existing) return Result.ok(existing);

    try {
      await this.loadScript();
    } catch (error) {
      LOGGER.warn("identity.google.services.unavailable", {
        code: "script_load_failed",
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return Result.err({ code: "google_unavailable" });
    }

    const accounts = globalThis.window.google?.accounts;
    if (accounts) return Result.ok(accounts);
    LOGGER.warn("identity.google.services.unavailable", { code: "accounts_missing" });
    return Result.err({ code: "google_unavailable" });
  }

  private loadScript(): Promise<void> {
    if (GoogleIdentityServices.#scriptLoadPromise) return GoogleIdentityServices.#scriptLoadPromise;

    const existing = this.#document.querySelector(`script[src="${GOOGLE_GIS_SCRIPT_URL}"]`);
    const readyState = (existing as (Element & { readyState?: string }) | null)?.readyState;
    if (existing?.getAttribute(GIS_LOAD_STATE_ATTRIBUTE) === "loaded" || readyState === "loaded" || readyState === "complete") {
      return Promise.resolve();
    }

    const script = existing ?? this.#document.createElement("script");
    if (!existing) {
      script.setAttribute("src", GOOGLE_GIS_SCRIPT_URL);
      script.setAttribute("async", "");
      script.setAttribute(GIS_LOAD_STATE_ATTRIBUTE, "loading");
    }

    const loading = new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        script.removeEventListener("load", loaded);
        script.removeEventListener("error", failed);
      };
      const loaded = (): void => {
        script.setAttribute(GIS_LOAD_STATE_ATTRIBUTE, "loaded");
        cleanup();
        resolve();
      };
      const failed = (): void => {
        cleanup();
        script.remove();
        reject(new Error("GIS load failed"));
      };
      const timer = setTimeout(failed, Math.max(0, this.#timeoutMs));
      script.addEventListener("load", loaded, { once: true });
      script.addEventListener("error", failed, { once: true });
      if (!existing) this.#document.head.append(script);
    });

    const shared = loading.finally(() => {
      if (GoogleIdentityServices.#scriptLoadPromise === shared) GoogleIdentityServices.#scriptLoadPromise = undefined;
    });
    GoogleIdentityServices.#scriptLoadPromise = shared;
    return shared;
  }
}
