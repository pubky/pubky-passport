import type { InternalClientOptions, PassportTimeouts } from "./PassportClientOptions.js";
import { invalidOption, PassportConfigError } from "./PassportConfigError.js";
import { resolveAppName, validateClientId } from "./appNameRules.js";
import { resolveCapabilities } from "./capabilityPolicy.js";
import { resolveNetworkOptions } from "./networkOptions.js";
import { DEFAULT_PASSPORT_INSTANCE } from "../shared/defaults.js";
import { validateInstanceOrigin, type InstanceInvalidDetail } from "../instance/instanceOrigin.js";

const INSTANCE_DETAIL_MESSAGES: Record<InstanceInvalidDetail, string> = {
  invalid_url: "Use a valid HTTPS Passport origin.",
  insecure_scheme: "Use HTTPS for the Passport origin.",
  credentials_not_allowed: "Passport origins must not contain credentials.",
  path_not_allowed: "Passport origins must not contain a path, query or fragment.",
  local_or_ip_not_allowed: "Use a domain origin without IP or localhost addresses.",
};

const DEFAULT_TIMEOUTS: Readonly<PassportTimeouts> = Object.freeze({
  handshakeHintMs: 15_000,
  closedGraceMs: 2_500,
  ringGraceMs: 90_000,
  detachedMs: 600_000,
  finishingMs: 60_000,
  attemptMs: 1_800_000,
  ringLinkRotateMs: 300_000,
});

export function resolveClientOptions(
  options: InternalClientOptions = {},
  validateCapabilities: (input: string) => string,
) {
  options = options ?? {};
  if (!isPlainObject(options)) throw new PassportConfigError([]);
  validateOptionTypes(options);
  const instance = validateInstanceOrigin(options.instance ?? DEFAULT_PASSPORT_INSTANCE, {
    allowLoopback: options.development?.allowLoopbackInstance === true,
  });
  if (!instance.ok)
    invalidOption(
      "instance",
      validateInstanceOrigin(options.instance ?? DEFAULT_PASSPORT_INSTANCE, { allowLoopback: true })
        .ok
        ? "Use a Passport on an HTTPS domain, not localhost or an IP address."
        : INSTANCE_DETAIL_MESSAGES[instance.detail],
    );
  const network = resolveNetworkOptions(options);
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
  return Object.freeze({
    ...options,
    ...(options.appName !== undefined ? { appName: resolveAppName(options.appName) } : {}),
    ...(options.clientId !== undefined ? { clientId: validateClientId(options.clientId) } : {}),
    capabilities: resolveCapabilities(options.capabilities ?? "", validateCapabilities),
    profile: options.profile ?? "required",
    network: network.network,
    pkarrRelays: network.pkarrRelays,
    httpRelay: network.httpRelay,
    instance: instance.origin,
    ...(options.development ? { development: Object.freeze({ ...options.development }) } : {}),
    ...(options.messages ? { messages: Object.freeze({ ...options.messages }) } : {}),
    timeouts: Object.freeze(timeouts),
  });
}

export type ResolvedClientOptions = ReturnType<typeof resolveClientOptions>;

/** Browser defaults are resolved only on the first operation that needs the page. */
export function resolveBrowserOptions(
  options: ResolvedClientOptions,
  page: Pick<Location, "hostname">,
) {
  return Object.freeze({
    ...options,
    appName: resolveAppName(options.appName ?? page.hostname),
    clientId: validateClientId(options.clientId ?? page.hostname),
  });
}

function validateOptionTypes(options: InternalClientOptions): void {
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
    options.pubky !== undefined &&
    (options.pubky === null || typeof options.pubky !== "object" || Array.isArray(options.pubky))
  )
    invalidOption("pubky", "Use a Pubky facade object.");
  for (const key of ["appName", "capabilities", "clientId", "instance"] as const)
    if (options[key] !== undefined && typeof options[key] !== "string")
      invalidOption(key, "Use a string.");
  if (
    options.profile !== undefined &&
    options.profile !== "required" &&
    options.profile !== "optional"
  )
    invalidOption("profile", 'Use "required" or "optional".');
  if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== "function")
    invalidOption("onDiagnostic", "Use a function.");
}

function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
