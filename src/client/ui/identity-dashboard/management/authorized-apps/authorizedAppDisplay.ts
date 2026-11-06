import type { PubkyAuthCapability } from "@/client/logic/authorization/request/parser/pubkyAuthCapabilities";
import type { PubkyAuthorizedApp } from "@/client/logic/pubky/PubkySdkAdapter";

/**
 * Splits a granted capability such as `/pub/app/:rw` into its path and actions. Unlike request
 * parsing this never rejects: an unrecognised value is shown as a path without actions.
 */
export function parseAuthorizedAppPermission(capability: string): PubkyAuthCapability {
  const match = /^([^:]+):([rwe]+)$/.exec(capability);
  const path = match?.[1] || capability;
  const actions = match?.[2] ?? "";
  return {
    path,
    read: actions.includes("r"),
    write: actions.includes("w"),
    encrypt: actions.includes("e"),
  };
}

export function permissionSummary(app: PubkyAuthorizedApp): string {
  const count = app.capabilities.length;
  if (count === 0) return "No data permissions";
  return count === 1 ? "1 permission" : `${count} permissions`;
}

/** Formats a grant timestamp given in Unix seconds; lists omit the time to stay on one line. */
export function formatGrantDate(
  unixSeconds: number,
  { locale, withTime = true }: { locale?: string; withTime?: boolean } = {},
): string {
  const date = new Date(unixSeconds * 1000);
  if (!Number.isFinite(unixSeconds) || Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(
    locale,
    withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" },
  ).format(date);
}

export function expiryLabel(
  app: PubkyAuthorizedApp,
  options: { locale?: string; withTime?: boolean } = {},
): string {
  return app.expiresAt <= 0
    ? "Does not expire"
    : `Expires ${formatGrantDate(app.expiresAt, options)}`;
}
