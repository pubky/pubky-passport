const MAXIMUM_HOSTNAME_CHARACTERS = 253;
const MAXIMUM_HOSTNAME_LABEL_CHARACTERS = 63;

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
