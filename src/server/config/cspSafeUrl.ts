import "server-only";

const MAXIMUM_URL_CHARACTERS = 2_048;
const MAXIMUM_HOSTNAME_CHARACTERS = 253;
const MAXIMUM_HOSTNAME_LABEL_CHARACTERS = 63;

export function parseCspSafeHttpsOrigin(value: string): string | null {
  if (value.length > MAXIMUM_URL_CHARACTERS) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || !isCspSafeHostname(url.hostname)
  ) {
    return null;
  }
  return url.origin;
}

export function isCspSafeHostname(hostname: string): boolean {
  if (
    hostname.length === 0
    || hostname.length > MAXIMUM_HOSTNAME_CHARACTERS
    || /^\d+(?:\.\d+){3}$/u.test(hostname)
  ) {
    return false;
  }

  return hostname.split(".").every((label) =>
    label.length <= MAXIMUM_HOSTNAME_LABEL_CHARACTERS
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label)
  );
}
