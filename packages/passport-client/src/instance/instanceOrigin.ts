export type InstanceInvalidDetail =
  | "invalid_url"
  | "insecure_scheme"
  | "credentials_not_allowed"
  | "path_not_allowed"
  | "local_or_ip_not_allowed";

export function validateInstanceOrigin(
  input: string,
  options: { allowLoopback?: boolean } = {},
): { ok: true; origin: string } | { ok: false; detail: InstanceInvalidDetail } {
  const invalid = (detail: InstanceInvalidDetail) => ({ ok: false as const, detail });
  if (typeof input !== "string") return invalid("invalid_url");
  const value = input.trim();
  if (!value || value.length > 2048 || /[\p{Cc}\s]/u.test(value)) return invalid("invalid_url");
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return invalid("invalid_url");
  }
  const host = url.hostname;
  const loopback =
    options?.allowLoopback === true && ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    return invalid("insecure_scheme");
  if (url.username || url.password) return invalid("credentials_not_allowed");
  if (!loopback) {
    if (
      /^(?:\d+\.){3}\d+$/u.test(host) ||
      host.startsWith("[") ||
      /(?:^|\.)localhost\.?$/u.test(host)
    )
      return invalid("local_or_ip_not_allowed");
    if (host.endsWith(".")) return invalid("invalid_url");
    if (
      host.length > 253 ||
      !host.split(".").every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/u.test(label))
    )
      return invalid("invalid_url");
    if (!host.includes(".")) return invalid("local_or_ip_not_allowed");
  }
  if (url.port === "0") return invalid("invalid_url");
  if (url.href !== `${url.origin}/`) return invalid("path_not_allowed");
  return { ok: true, origin: url.origin };
}
