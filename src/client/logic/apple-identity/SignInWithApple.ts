import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { isAppleEmail, isAppleName, isAppleSubject } from "@/libs/appleAccount";
import { decodeBase64Url, encodeBase64Url } from "@/libs/encoding/base64Url";
import { LOGGER } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";

export const APPLE_AUTHORIZE_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_ORIGIN = "https://appleid.apple.com";
const APPLE_SCOPES = "name email";
const POPUP_FEATURES = "popup,width=520,height=680";
const POPUP_CLOSED_POLL_MS = 300;
const MAXIMUM_MESSAGE_CHARACTERS = 16 * 1024;
/** Apple ID tokens live ten minutes; never rely on one for longer, whatever `exp` says. */
const MAXIMUM_TOKEN_LIFETIME_SECONDS = 10 * 60;

/**
 * A Sign in with Apple ID token, the claims Passport read from it after checking them, and the
 * name Apple sent beside it. Only the token ever leaves the browser.
 */
export type AppleIdentityCredentials = Readonly<{
  appleIdToken: string;
  appleSubject: string;
  /** The token's email claim, possibly a private relay address. Shown, never sent anywhere. */
  email: string | null;
  /** Apple sends the name only on the first authorization of this Services ID. */
  name: string | null;
  /** When Passport stops using the token, in milliseconds since the epoch. */
  expiresAt: number;
}>;

export type SignInWithAppleError = CodedFailure<
  "apple_sign_in_popup_blocked" | "apple_sign_in_cancelled" | "apple_sign_in_failed"
>;

/**
 * Sign in with Apple in a popup, without Apple's JavaScript on Passport's origin. Passport opens
 * Apple's authorize page with `response_mode=web_message`; Apple's page posts the result back
 * with `postMessage`. Only a message from that popup window on https://appleid.apple.com is read.
 *
 * Scopes `name email`, as Google's profile: the email is a claim in every ID token; the name
 * comes only in the response's `user` object and only the first time the user authorizes this
 * Services ID. Both stay in this browser. A fresh nonce and state bind each response to this
 * attempt. The server verifies the token's signature; the browser checks the claims it relies
 * on before using the token.
 */
export class SignInWithApple {
  /**
   * @param servicesId Services ID registered as the Sign in with Apple client.
   * @param redirectUri Return URL registered for that Services ID. The web_message mode never
   * navigates there, but Apple requires a registered value.
   */
  constructor(
    private readonly servicesId: string,
    private readonly redirectUri: string,
    private readonly appWindow: Window = globalThis.window,
  ) {}

  /**
   * Opens Apple's popup synchronously, so call it directly from the click handler, then settles
   * with the checked credentials. The promise does not intentionally reject.
   */
  signIn(): Promise<ResultType<AppleIdentityCredentials, SignInWithAppleError>> {
    const state = randomBase64Url(32);
    const nonce = randomBase64Url(32);
    let popup: Window | null;
    try {
      popup = this.appWindow.open(this.authorizeUrl(state, nonce), "_blank", POPUP_FEATURES);
    } catch {
      popup = null;
    }
    if (!popup) {
      LOGGER.info("identity.apple.sign_in.failed", { stage: "open", code: "popup_blocked" });
      return Promise.resolve(Result.err({ code: "apple_sign_in_popup_blocked" }));
    }
    return this.awaitResponse(popup, state, nonce);
  }

  private authorizeUrl(state: string, nonce: string): string {
    const parameters: Array<[string, string]> = [
      ["client_id", this.servicesId],
      ["redirect_uri", this.redirectUri],
      ["response_type", "code id_token"],
      ["state", state],
      ["scope", APPLE_SCOPES],
      ["nonce", nonce],
      ["response_mode", "web_message"],
      ["frame_id", globalThis.crypto.randomUUID()],
      // Apple's own script (appleid.auth.js 1.5.7) sends these two; Apple's page reads them.
      ["m", "11"],
      ["v", "1.5.7"],
    ];
    // Percent-encoded like Apple's script, so the scope reads "name%20email", not "name+email".
    const query = parameters
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      .join("&");
    return `${APPLE_AUTHORIZE_URL}?${query}`;
  }

  private awaitResponse(
    popup: Window,
    state: string,
    nonce: string,
  ): Promise<ResultType<AppleIdentityCredentials, SignInWithAppleError>> {
    return new Promise((resolve) => {
      const finish = (result: ResultType<AppleIdentityCredentials, SignInWithAppleError>) => {
        clearInterval(closedPoll);
        this.appWindow.removeEventListener("message", onMessage);
        try {
          if (!popup.closed) popup.close();
        } catch {
          /* Cross-origin popup cleanup is best effort. */
        }
        resolve(result);
      };
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== APPLE_ORIGIN || event.source !== popup) return;
        const data = parseMessage(event.data);
        if (!data) return;
        finish(this.readResponse(data, state, nonce));
      };
      const closedPoll = setInterval(() => {
        let closed: boolean;
        try {
          closed = popup.closed;
        } catch {
          closed = false;
        }
        if (!closed) return;
        LOGGER.info("identity.apple.sign_in.failed", { stage: "popup", code: "closed" });
        finish(Result.err({ code: "apple_sign_in_cancelled" }));
      }, POPUP_CLOSED_POLL_MS);
      this.appWindow.addEventListener("message", onMessage);
    });
  }

  private readResponse(
    data: Record<string, unknown>,
    state: string,
    nonce: string,
  ): ResultType<AppleIdentityCredentials, SignInWithAppleError> {
    if ("error" in data) {
      const code = appleErrorCode(data.error);
      LOGGER.info("identity.apple.sign_in.failed", { stage: "popup", code });
      return Result.err({ code });
    }
    const authorization = data.authorization;
    if (!isRecord(authorization) || authorization.state !== state) {
      LOGGER.warn("identity.apple.sign_in.failed", { stage: "response", code: "state_mismatch" });
      return Result.err({ code: "apple_sign_in_failed" });
    }
    const idToken = authorization.id_token;
    const claims = typeof idToken === "string" ? readClaims(idToken) : undefined;
    const checked = claims ? this.checkClaims(claims, nonce) : undefined;
    if (typeof idToken !== "string" || !checked) {
      LOGGER.warn("identity.apple.sign_in.failed", { stage: "response", code: "invalid_token" });
      return Result.err({ code: "apple_sign_in_failed" });
    }
    return Result.ok(
      Object.freeze({ appleIdToken: idToken, ...checked, name: readName(data.user) }),
    );
  }

  private checkClaims(
    claims: Record<string, unknown>,
    nonce: string,
  ): { appleSubject: string; email: string | null; expiresAt: number } | undefined {
    const audience = claims.aud;
    const audienceMatches =
      audience === this.servicesId ||
      (Array.isArray(audience) && audience.length === 1 && audience[0] === this.servicesId);
    const { exp, iat, sub } = claims;
    if (
      claims.iss !== APPLE_ORIGIN ||
      !audienceMatches ||
      claims.nonce !== nonce ||
      typeof exp !== "number" ||
      typeof iat !== "number" ||
      !isAppleSubject(sub)
    ) {
      return undefined;
    }
    const expiresAt = Math.min(exp, iat + MAXIMUM_TOKEN_LIFETIME_SECONDS) * 1000;
    if (expiresAt <= Date.now()) return undefined;
    return {
      appleSubject: sub,
      email: isAppleEmail(claims.email) ? claims.email : null,
      expiresAt,
    };
  }
}

/** Apple's page posts a JSON string `{ method: "oauthDone", data }`. */
function parseMessage(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || value.length > MAXIMUM_MESSAGE_CHARACTERS) return undefined;
  try {
    const message: unknown = JSON.parse(value);
    if (!isRecord(message) || message.method !== "oauthDone") return undefined;
    return isRecord(message.data) ? message.data : undefined;
  } catch {
    return undefined;
  }
}

function appleErrorCode(error: unknown): SignInWithAppleError["code"] {
  switch (error) {
    case "popup_closed_by_user":
    case "user_cancelled_authorize":
    case "user_trigger_new_signin_flow":
      return "apple_sign_in_cancelled";
    default:
      return "apple_sign_in_failed";
  }
}

/**
 * Reads the name from the response's `user` object, `{ name: { firstName, lastName } }`. Apple
 * sends it as an object in web_message mode; a JSON string is accepted as in form_post mode.
 */
function readName(user: unknown): string | null {
  let value = user;
  if (typeof value === "string" && value.length <= MAXIMUM_MESSAGE_CHARACTERS) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || !isRecord(value.name)) return null;
  const parts = [value.name.firstName, value.name.lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0);
  const name = parts.join(" ");
  return isAppleName(name) ? name : null;
}

/** Reads an unverified JWT payload; the server verifies the signature before trusting it. */
function readClaims(idToken: string): Record<string, unknown> | undefined {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  const bytes = decodeBase64Url(parts[1]);
  if (!bytes) return undefined;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function randomBase64Url(byteLength: number): string {
  return encodeBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(byteLength)));
}
