import "client-only";

import { Result } from "better-result";

import type { AuthorizationEntry } from "@/client/logic/authorization/entry/authorizationEntry";
import { ValidatedPubkyAuthRequest } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import {
  EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY,
  GOOGLE_REDIRECT_STORAGE_KEY,
} from "@/libs/authorization/googleRedirectConstants";
import {
  AUTHORIZATION_CAPTURE_MAX_CHARACTERS,
  AUTHORIZATION_TIMEOUT_MS,
} from "@/libs/passportPolicy";
import { isRecord } from "@/libs/typeGuards";

export type GoogleRedirectOperation = {
  operation: "establish" | "replace_invalid_passport_file" | "replace_undecryptable_passport_file";
  allowWithoutVisibleBackup: boolean;
  googleSubject?: string;
};

export type GoogleRedirectAttempt = GoogleRedirectOperation & {
  version: 1;
  requestUrl: string;
  state: string;
  nonce: string;
  expiresAt: number;
};

type RedirectContext = {
  request: ValidatedPubkyAuthRequest;
  response?: { attempt: GoogleRedirectAttempt; capture: unknown };
};

let context: RedirectContext | undefined;
let returnedFromGoogle = false;

/** Page-scoped private state shared by bootstrap and the Google controller, never React state. */
export function getGoogleRedirectContext(): RedirectContext | undefined {
  return context?.request.isLive() ? context : undefined;
}

export function isGoogleRedirectReturn(): boolean {
  return returnedFromGoogle;
}

/** Return to the relay-enabled route after setup, without persisting credentials. */
export function returnToAuthorization(): void {
  const requestUrl = getGoogleRedirectContext()?.request.validatedUrlForApproval();
  if (!requestUrl) return;
  window.location.replace(`/authorize#d=${encodeURIComponent(requestUrl)}`);
}

/** A fresh /authorize request supersedes any abandoned redirect in this tab. */
export function setGoogleRedirectRequest(entry: AuthorizationEntry, appWindow: Window): void {
  context = entry.status === "valid" ? { request: entry.request } : undefined;
  returnedFromGoogle = false;
  try {
    appWindow.sessionStorage.removeItem(GOOGLE_REDIRECT_STORAGE_KEY);
  } catch {
    // Starting a redirect will fail closed if storage remains unavailable.
  }
}

/** Consumes one pending attempt at the existing root callback, including cancellation/errors. */
export function resumeGoogleRedirect(appWindow: Window): AuthorizationEntry | undefined {
  const take = (appWindow as Window & Record<string, unknown>)[
    EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY
  ];
  let raw: string | null;
  let capture: unknown;
  try {
    capture = typeof take === "function" ? take() : undefined;
    raw = appWindow.sessionStorage.getItem(GOOGLE_REDIRECT_STORAGE_KEY);
    appWindow.sessionStorage.removeItem(GOOGLE_REDIRECT_STORAGE_KEY);
  } catch {
    if (typeof take !== "function") return undefined;
    returnedFromGoogle = true;
    return { status: "invalid" };
  }
  if (raw === null && typeof take !== "function") return undefined;
  returnedFromGoogle = true;
  context = undefined;
  const attempt = parseAttempt(raw);
  if (!attempt) return { status: "invalid" };
  if (Date.now() >= attempt.expiresAt) return { status: "expired" };
  const parsed = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(attempt.requestUrl));
  if (Result.isError(parsed)) return { status: "invalid" };
  context = { request: parsed.value, response: { attempt, capture } };
  return { status: "valid", request: parsed.value };
}

function parseAttempt(raw: string | null): GoogleRedirectAttempt | undefined {
  if (!raw || raw.length > AUTHORIZATION_CAPTURE_MAX_CHARACTERS) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || typeof value.requestUrl !== "string")
      return undefined;
    if (typeof value.state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.state))
      return undefined;
    if (typeof value.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.nonce))
      return undefined;
    if (
      typeof value.expiresAt !== "number" ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt > Date.now() + AUTHORIZATION_TIMEOUT_MS
    )
      return undefined;
    if (
      value.operation !== "establish" &&
      value.operation !== "replace_invalid_passport_file" &&
      value.operation !== "replace_undecryptable_passport_file"
    )
      return undefined;
    if (typeof value.allowWithoutVisibleBackup !== "boolean") return undefined;
    if (
      value.googleSubject !== undefined &&
      (typeof value.googleSubject !== "string" ||
        value.googleSubject.length === 0 ||
        value.googleSubject.length > 255)
    )
      return undefined;
    return value as GoogleRedirectAttempt;
  } catch {
    // JSON errors can contain the relay secret. Never log or retain them.
    return undefined;
  }
}
