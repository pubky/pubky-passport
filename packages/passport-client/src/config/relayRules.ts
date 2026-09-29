import { invalidOption } from "./PassportConfigError.js";

export function validateRelay(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return invalidRelay();
  }
  const hostname = url.hostname.replace(/\.$/u, "");
  const exactHost =
    /^\[[0-9a-f:.]+\]$/iu.test(hostname) ||
    (hostname.length <= 253 &&
      hostname.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(part)));
  if (
    input.length > 2_048 ||
    url.href.length > 2_048 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.href.includes("#") ||
    !exactHost ||
    /\/link\/?$/u.test(url.pathname)
  )
    return invalidRelay();
  return url.href;
}

function invalidRelay(): never {
  return invalidOption(
    "relay",
    "Use an HTTPS inbox relay without credentials, a port or a fragment.",
  );
}
