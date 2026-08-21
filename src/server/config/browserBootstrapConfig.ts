import "server-only";

import { z } from "zod";

import { isCspSafeHostname } from "../../libs/http/cspSafeHostname";

const MAXIMUM_URL_CHARACTERS = 2_048;

export function getBrowserBootstrapConfig() {
  const googleClientId = z.string().trim().min(1, "GOOGLE_CLIENT_ID is required")
    .parse(process.env.GOOGLE_CLIENT_ID);
  const homegate = z.string().trim().min(1, "HOMEGATE_URL is required")
    .transform((value, context) => {
      const homegate = parseHomegateUrl(value);
      if (homegate) return homegate;

      context.addIssue({
        code: "custom",
        message: "HOMEGATE_URL must be a CSP-safe HTTPS base URL",
      });
      return z.NEVER;
    })
    .parse(process.env.HOMEGATE_URL);

  return {
    googleClientId,
    homegateBaseUrl: homegate.baseUrl,
    homegateOrigin: homegate.origin,
  };
}

function parseHomegateUrl(value: string): { baseUrl: string; origin: string } | null {
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
    || url.search
    || url.hash
    || !isCspSafeHostname(url.hostname)
  ) {
    return null;
  }

  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  if (url.href.length > MAXIMUM_URL_CHARACTERS) return null;
  return { baseUrl: url.href, origin: url.origin };
}
