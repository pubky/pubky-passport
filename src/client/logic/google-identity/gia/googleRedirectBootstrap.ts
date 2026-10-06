import "client-only";

import { Result } from "better-result";

import type { AuthorizationEntry } from "@/client/logic/authorization/entry/authorizationEntry";
import { announceExternalNavigation } from "@/client/logic/authorization/flow/leaveGuard";
import { AUTHORIZATION_ENTRY_PATH } from "@/libs/authorization/authorizationLocationRules";
import { ValidatedPubkyAuthRequest } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import {
  EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY,
  GOOGLE_REDIRECT_STORAGE_KEY,
} from "@/libs/authorization/googleRedirectConstants";
import {
  AUTHORIZATION_CAPTURE_MAX_CHARACTERS,
  AUTHORIZATION_TIMEOUT_MS,
} from "@/libs/passportPolicy";
import { isGoogleNoncePreimage } from "@/libs/googleNonce";
import { isRecord } from "@/libs/typeGuards";

export type GoogleRedirectOperation = {
  operation: "establish" | "replace_invalid_passport_file" | "replace_undecryptable_passport_file";
  allowWithoutVisibleBackup: boolean;
  googleSubject?: string;
};

export type GoogleRedirectAttempt = GoogleRedirectOperation & {
  /** 2: the nonce's preimage replaced the nonce; an attempt saved by an older page is dropped. */
  version: 2;
  requestUrl: string;
  state: string;
  /** Google got its hash as the `nonce`; see `googleNonceFor`. */
  noncePreimage: string;
  expiresAt: number;
  /** The app asked for an identity with a pubky.app profile; kept across the round trip. */
  profileRequired?: true;
};

type RedirectContext = {
  request: ValidatedPubkyAuthRequest;
  profileRequired?: true;
  response?: { attempt: GoogleRedirectAttempt; capture: unknown };
};

/**
 * What a returned page reports when the saved attempt is missing, damaged or unreadable. The
 * callback page answers no opener with it (its channel says `empty`, as `/` always does), so the
 * code only has to be one the entry type already knows: the request could not be carried through
 * the browser's own state.
 */
const UNAVAILABLE = { status: "invalid", code: "history_unavailable" } as const;

let context: RedirectContext | undefined;
let returnedFromGoogle = false;

/** Page-scoped private state shared by bootstrap and the Google controller, never React state. */
export function getGoogleRedirectContext(): RedirectContext | undefined {
  return context?.request.isLive() ? context : undefined;
}

export function isGoogleRedirectReturn(): boolean {
  return returnedFromGoogle;
}

/**
 * Returns to the one page a request enters at, after setup or when the person turns back, without
 * persisting credentials: the callback page never reviews or approves anything. Says whether it
 * could; a request that is gone (expired, or its saved attempt unusable) has nowhere to return to.
 */
export function returnToAuthorization(appWindow: Window = window): boolean {
  const redirect = getGoogleRedirectContext();
  const requestUrl = redirect?.request.validatedUrlForApproval();
  if (!redirect || !requestUrl) return false;
  // The request goes with the navigation, so this is not leaving it behind.
  announceExternalNavigation(appWindow);
  appWindow.location.replace(
    `${AUTHORIZATION_ENTRY_PATH}#d=${encodeURIComponent(requestUrl)}${
      redirect.profileRequired ? "&profile=required" : ""
    }`,
  );
  return true;
}

/**
 * The app behind `request` asked for an identity with a profile after the page loaded (its hello
 * said so): a Google round trip started from here keeps the requirement.
 */
export function requireProfileAfterGoogleRedirect(request: ValidatedPubkyAuthRequest): void {
  if (context?.request === request) context.profileRequired = true;
}

/** A fresh /authorize request supersedes any abandoned redirect in this tab. */
export function setGoogleRedirectRequest(entry: AuthorizationEntry, appWindow: Window): void {
  context =
    entry.status === "valid"
      ? {
          request: entry.request,
          ...(entry.profile === "required" ? { profileRequired: true as const } : {}),
        }
      : undefined;
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
    return UNAVAILABLE;
  }
  if (raw === null && typeof take !== "function") return undefined;
  returnedFromGoogle = true;
  context = undefined;
  const attempt = parseAttempt(raw);
  if (!attempt) return UNAVAILABLE;
  if (Date.now() >= attempt.expiresAt) return { status: "expired" };
  const parsed = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(attempt.requestUrl));
  if (Result.isError(parsed)) return UNAVAILABLE;
  const profile = attempt.profileRequired ? { profileRequired: true as const } : {};
  context = { request: parsed.value, ...profile, response: { attempt, capture } };
  return {
    status: "valid",
    request: parsed.value,
    ...(attempt.profileRequired ? { profile: "required" as const } : {}),
  };
}

function parseAttempt(raw: string | null): GoogleRedirectAttempt | undefined {
  if (!raw || raw.length > AUTHORIZATION_CAPTURE_MAX_CHARACTERS) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 2 || typeof value.requestUrl !== "string")
      return undefined;
    if (typeof value.state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.state))
      return undefined;
    if (!isGoogleNoncePreimage(value.noncePreimage)) return undefined;
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
    if (value.profileRequired !== undefined && value.profileRequired !== true) return undefined;
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
