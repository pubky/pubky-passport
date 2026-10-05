import type { resolveBrowserOptions } from "../config/resolveClientOptions.js";

type FingerprintOptions = Pick<
  ReturnType<typeof resolveBrowserOptions>,
  "appName" | "capabilities" | "clientId" | "instance" | "profile"
>;

/** The input has already passed static and browser-dependent configuration validation. */
export function clientFingerprint(options: FingerprintOptions): string {
  return JSON.stringify([
    options.appName,
    options.capabilities,
    options.clientId,
    options.instance,
    options.profile,
  ]);
}
