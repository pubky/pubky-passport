import type { PassportClientOptions, PassportTimeouts } from "./PassportClientOptions.js";
import { invalidOption, PassportConfigError } from "./PassportConfigError.js";
import { resolveAppName, validateClientId } from "./appNameRules.js";
import { resolveCapabilities } from "./capabilityPolicy.js";
import { validateRelay } from "./relayRules.js";
import { resolveReturnPath } from "./returnPath.js";
import { DEFAULT_PASSPORT_INSTANCE } from "../shared/defaults.js";

const DEFAULT_TIMEOUTS: Readonly<PassportTimeouts> = Object.freeze({
  handshakeHintMs: 15_000,
  closedGraceMs: 2_500,
  ringGraceMs: 90_000,
  detachedMs: 600_000,
  finishingMs: 60_000,
  attemptMs: 1_800_000,
  ringLinkRotateMs: 300_000,
  redirectStateTtlMs: 1_800_000,
});

export function resolveClientOptions(
  options: PassportClientOptions = {},
  validateCapabilities: (input: string) => string,
) {
  options = options ?? {};
  if (!isPlainObject(options)) throw new PassportConfigError([]);
  validateOptionTypes(options);
  const timeouts = { ...DEFAULT_TIMEOUTS };
  for (const key of Object.keys(options.timeouts ?? {}))
    if (!Object.hasOwn(DEFAULT_TIMEOUTS, key)) invalidOption("timeouts", "Unknown timeout option.");
  for (const key of Object.keys(DEFAULT_TIMEOUTS) as (keyof PassportTimeouts)[]) {
    const value = options.timeouts?.[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 1 || value > 2 ** 31 - 1)
      invalidOption(
        "timeouts",
        `${key} must be an integer from 1 through 2147483647 milliseconds.`,
      );
    timeouts[key] = value;
  }
  if (options.timeouts?.redirectStateTtlMs === undefined)
    timeouts.redirectStateTtlMs = Math.min(DEFAULT_TIMEOUTS.redirectStateTtlMs, timeouts.attemptMs);
  if (timeouts.redirectStateTtlMs > timeouts.attemptMs)
    invalidOption("timeouts", "redirectStateTtlMs must not exceed attemptMs.");
  const relay = validateRelay(options.relay);
  return Object.freeze({
    ...options,
    ...(options.appName !== undefined ? { appName: resolveAppName(options.appName) } : {}),
    ...(options.clientId !== undefined ? { clientId: validateClientId(options.clientId) } : {}),
    capabilities: resolveCapabilities(
      options.capabilities ?? "",
      validateCapabilities,
      options.allowBroadCapabilities,
    ),
    requireProfile: options.requireProfile ?? true,
    instance: options.instance ?? DEFAULT_PASSPORT_INSTANCE,
    allowCustomInstance: options.allowCustomInstance ?? true,
    popupBlocked: options.popupBlocked ?? "redirect",
    allowLocalRedirectState: options.allowLocalRedirectState ?? false,
    allowBroadCapabilities: options.allowBroadCapabilities ?? false,
    ...(relay !== undefined ? { relay } : {}),
    ...(options.allowedInstances
      ? { allowedInstances: Object.freeze([...options.allowedInstances]) }
      : {}),
    ...(options.development ? { development: Object.freeze({ ...options.development }) } : {}),
    ...(options.messages ? { messages: Object.freeze({ ...options.messages }) } : {}),
    timeouts: Object.freeze(timeouts),
  });
}

export type ResolvedClientOptions = ReturnType<typeof resolveClientOptions>;

/** Browser defaults are resolved only on the first operation that needs the page. */
export function resolveBrowserOptions(
  options: ResolvedClientOptions,
  page: Pick<Location, "hostname" | "origin" | "pathname">,
) {
  return Object.freeze({
    ...options,
    appName: resolveAppName(options.appName ?? page.hostname),
    clientId: validateClientId(options.clientId ?? page.hostname),
    returnPath: resolveReturnPath(options.returnPath, page),
  });
}

function validateOptionTypes(options: PassportClientOptions): void {
  for (const key of ["timeouts", "development", "messages"] as const)
    if (options[key] !== undefined && !isPlainObject(options[key]))
      invalidOption(key, "Use a plain options object.");
  if (
    options.development?.allowLoopbackInstance !== undefined &&
    typeof options.development.allowLoopbackInstance !== "boolean"
  )
    invalidOption("development", "allowLoopbackInstance must be a boolean.");
  if (
    options.development?.openWindow !== undefined &&
    typeof options.development.openWindow !== "function"
  )
    invalidOption("development", "openWindow must be a function.");
  if (
    options.allowedInstances !== undefined &&
    (!Array.isArray(options.allowedInstances) ||
      options.allowedInstances.some((entry) => typeof entry !== "string"))
  )
    invalidOption("allowedInstances", "Use an array of origin strings.");
  if (
    options.pubky !== undefined &&
    (options.pubky === null || typeof options.pubky !== "object" || Array.isArray(options.pubky))
  )
    invalidOption("pubky", "Use a Pubky facade object.");
  for (const key of [
    "appName",
    "capabilities",
    "clientId",
    "instance",
    "relay",
    "returnPath",
  ] as const)
    if (options[key] !== undefined && typeof options[key] !== "string")
      invalidOption(key, "Use a string.");
  for (const key of [
    "requireProfile",
    "allowCustomInstance",
    "allowLocalRedirectState",
    "allowBroadCapabilities",
  ] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean")
      invalidOption(key, "Use a boolean.");
  for (const key of ["onBeforeRedirect", "onDiagnostic"] as const)
    if (options[key] !== undefined && typeof options[key] !== "function")
      invalidOption(key, "Use a function.");
  if (
    options.popupBlocked !== undefined &&
    !["redirect", "prompt", "fail"].includes(options.popupBlocked)
  )
    invalidOption("popupBlocked", "Use redirect, prompt or fail.");
}

function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
