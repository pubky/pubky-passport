import type { resolveBrowserOptions } from "../config/resolveClientOptions.js";

type FingerprintOptions = Pick<
  ReturnType<typeof resolveBrowserOptions>,
  | "appName"
  | "capabilities"
  | "clientId"
  | "instance"
  | "profile"
  | "network"
  | "pkarrRelays"
  | "httpRelay"
>;

/**
 * The input has already passed static and browser-dependent configuration validation. The
 * network and relays join only when set, so a mainnet client keeps its earlier fingerprint.
 */
export function clientFingerprint(options: FingerprintOptions): string {
  const network =
    options.network !== "mainnet" ||
    options.pkarrRelays !== undefined ||
    options.httpRelay !== undefined;
  return JSON.stringify([
    options.appName,
    options.capabilities,
    options.clientId,
    options.instance,
    options.profile,
    ...(network ? [options.network, options.pkarrRelays ?? null, options.httpRelay ?? null] : []),
  ]);
}
