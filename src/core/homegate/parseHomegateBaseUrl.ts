type HomegateBaseUrl = {
  readonly href: string;
  readonly origin: string;
};

const maximumHomegateBaseUrlCharacters = 2_048;
const maximumDnsHostnameCharacters = 253;
const maximumDnsLabelCharacters = 63;
const dnsLabelPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu;
const ipv4AddressPattern = /^\d+(?:\.\d+){3}$/u;

export function parseHomegateBaseUrl(value: string): HomegateBaseUrl | null {
  if (value.length === 0 || value.length > maximumHomegateBaseUrlCharacters) return null;

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
    || url.href.includes("?")
    || url.href.includes("#")
    || !isCspSafeDnsHostname(url.hostname)
  ) {
    return null;
  }

  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  if (url.href.length > maximumHomegateBaseUrlCharacters) return null;
  return { href: url.href, origin: url.origin };
}

function isCspSafeDnsHostname(hostname: string): boolean {
  if (
    hostname.length === 0
    || hostname.length > maximumDnsHostnameCharacters
    || ipv4AddressPattern.test(hostname)
  ) {
    return false;
  }

  return hostname.split(".").every((label) =>
    label.length <= maximumDnsLabelCharacters && dnsLabelPattern.test(label)
  );
}
