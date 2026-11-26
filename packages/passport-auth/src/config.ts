import { validateCapabilities } from "@synonymdev/pubky";

import { returnUrl } from "./protocol.js";

export const DEFAULT_INSTANCE = "https://passport.pubky.app";
export const DEFAULT_TIMEOUT_MS = 300_000;

/** Same limits Passport applies to the request (`pubkyAuthRequestParser.ts`, `pubkyAuthUrls.ts`). */
const MAXIMUM_APP_NAME_LENGTH = 128;
const MAXIMUM_CLIENT_ID_BYTES = 253;
const MAXIMUM_CALLBACK_LENGTH = 2_048;
/**
 * Passport caps the decoded pubkyauth URL at 8,192 characters; the three callbacks travel in it
 * percent-encoded. Keep them within half of it, leaving room for the other parameters.
 */
const MAXIMUM_ENCODED_CALLBACKS_LENGTH = 4_096;
/** Largest delay `setTimeout` accepts without firing at once. */
const MAXIMUM_TIMEOUT_MS = 2_147_483_647;
// Matches UNSAFE_SOURCE_CHARACTERS in Passport's request parser.
const UNSAFE_NAME = /[\p{Cc}\p{Zl}\p{Zp}؜​‎‏‪-‮⁠⁦-⁩﻿]/u;
const ROOT_PATHS: ReadonlySet<string> = new Set(["/", "/pub", "/pub/", "/priv", "/priv/"]);
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Thrown by `createPassportAuth` for options Passport would refuse or that are unsafe. */
export class PassportConfigError extends Error {
  override readonly name = "PassportConfigError";
  readonly option: string;

  constructor(option: string, message: string) {
    super(`@pubky/passport-auth: invalid ${option}: ${message}`);
    this.option = option;
  }
}

export interface ResolvedConfig {
  instanceOrigin: string;
  capabilities: string;
  signedApproval: boolean;
  clientId: string;
  appName: string;
  callbackUrl: string | undefined;
  timeoutMs: number;
}

export interface ConfigInput {
  capabilities: string;
  clientId: string;
  appName: string;
  instance?: string | undefined;
  callbackUrl?: string | undefined;
  timeoutMs?: number | undefined;
}

export function resolveConfig(input: ConfigInput, pageUrl: string): ResolvedConfig {
  const capabilities = resolveCapabilities(input.capabilities);
  return {
    instanceOrigin: resolveInstance(input.instance ?? DEFAULT_INSTANCE),
    capabilities,
    signedApproval: requestsKeys(capabilities),
    clientId: resolveClientId(input.clientId),
    appName: resolveAppName(input.appName),
    callbackUrl:
      input.callbackUrl === undefined ? undefined : resolveCallback(input.callbackUrl, pageUrl),
    timeoutMs: resolveTimeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };
}

function resolveInstance(input: unknown): string {
  const invalid = (why: string): never => {
    throw new PassportConfigError("instance", `${why} Use an origin such as ${DEFAULT_INSTANCE}.`);
  };
  if (typeof input !== "string") return invalid("Expected a string.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return invalid("Not an absolute URL.");
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    invalid("Use https (http only on localhost, 127.0.0.1 or [::1]).");
  if (url.username || url.password) invalid("Credentials are not allowed.");
  if (url.href !== `${url.origin}/`) invalid("Use an origin without path, query or fragment.");
  return url.origin;
}

function resolveCapabilities(input: unknown): string {
  if (typeof input !== "string")
    throw new PassportConfigError(
      "capabilities",
      "Expected a string such as /pub/example.app/:rw.",
    );
  let normalized: string;
  try {
    normalized = validateCapabilities(input);
  } catch (error) {
    throw new PassportConfigError(
      "capabilities",
      `The Pubky SDK rejected them (${errorText(error)}). Use entries such as /pub/example.app/:rw.`,
    );
  }
  for (const entry of entries(normalized)) {
    if (ROOT_PATHS.has(entry.path))
      throw new PassportConfigError(
        "capabilities",
        `${entry.path} is a root. Request a narrower path, such as /pub/example.app/.`,
      );
  }
  return normalized;
}

function requestsKeys(capabilities: string): boolean {
  return entries(capabilities).some((entry) => entry.actions.includes("e"));
}

function entries(capabilities: string): { path: string; actions: string }[] {
  if (capabilities === "") return [];
  return capabilities.split(",").map((entry) => {
    const colon = entry.lastIndexOf(":");
    return { path: entry.slice(0, colon), actions: entry.slice(colon + 1) };
  });
}

function resolveClientId(input: unknown): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    new TextEncoder().encode(input).length > MAXIMUM_CLIENT_ID_BYTES
  )
    throw new PassportConfigError(
      "clientId",
      `Use 1 to ${MAXIMUM_CLIENT_ID_BYTES} bytes, typically your app's domain.`,
    );
  return input;
}

function resolveAppName(input: unknown): string {
  const name = typeof input === "string" ? input.trim().normalize("NFC") : "";
  if (!name || name.length > MAXIMUM_APP_NAME_LENGTH || UNSAFE_NAME.test(name))
    throw new PassportConfigError(
      "appName",
      `Use 1 to ${MAXIMUM_APP_NAME_LENGTH} characters without control, bidirectional or zero-width characters.`,
    );
  return name;
}

function resolveCallback(input: unknown, pageUrl: string): string {
  if (typeof input !== "string" || input === "")
    throw new PassportConfigError("callbackUrl", "Expected a path such as /passport/return.");
  let url: URL;
  try {
    url = new URL(input, pageUrl);
  } catch {
    throw new PassportConfigError("callbackUrl", "Not a valid URL.");
  }
  const page = new URL(pageUrl);
  if (url.origin !== page.origin)
    throw new PassportConfigError(
      "callbackUrl",
      `It must share this page's origin (${page.origin}), or Passport cannot hand the outcome back.`,
    );
  if (url.protocol !== "https:")
    throw new PassportConfigError(
      "callbackUrl",
      "Passport accepts only HTTPS callbacks. Omit callbackUrl while developing over plain HTTP.",
    );
  url.hash = "";
  // Measure what Passport receives: adding the attempt parameters re-encodes the query, and the
  // request carries all three callbacks percent-encoded.
  const callbacks = (["success", "error", "cancel"] as const).map((outcome) =>
    returnUrl(url.href, "x".repeat(36), outcome),
  );
  const encoded = callbacks.reduce((sum, callback) => sum + encodeURIComponent(callback).length, 0);
  if (
    callbacks.some((callback) => callback.length > MAXIMUM_CALLBACK_LENGTH) ||
    encoded > MAXIMUM_ENCODED_CALLBACKS_LENGTH
  )
    throw new PassportConfigError("callbackUrl", "It is too long.");
  return url.href;
}

function resolveTimeout(input: unknown): number {
  if (
    typeof input !== "number" ||
    !Number.isFinite(input) ||
    input <= 0 ||
    input > MAXIMUM_TIMEOUT_MS
  )
    throw new PassportConfigError("timeoutMs", "Use a positive number of milliseconds.");
  return input;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error)
    return String((error as { message: unknown }).message);
  return String(error);
}
