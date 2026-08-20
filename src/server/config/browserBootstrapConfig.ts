import "server-only";

import { z } from "zod";

import { isCspSafeHostname } from "./cspSafeUrl";

type EnvLike = Record<string, string | undefined>;

export type BrowserBootstrapConfig = {
  googleClientId: string;
  homegateBaseUrl: string;
  homegateOrigin: string;
};

const MAXIMUM_URL_CHARACTERS = 2_048;

function parseBrowserBootstrapConfig(input: EnvLike): BrowserBootstrapConfig {
  const googleClientId = requiredString("GOOGLE_CLIENT_ID").parse(input.GOOGLE_CLIENT_ID);
  const homegate = z
    .object({
      HOMEGATE_URL: requiredString("HOMEGATE_URL").transform((value, context) => {
        const homegate = parseHomegateUrl(value);
        if (homegate) return homegate;

        context.addIssue({
          code: "custom",
          message: "HOMEGATE_URL must be a CSP-safe HTTPS base URL",
        });
        return z.NEVER;
      }),
    })
    .parse(input);

  return {
    googleClientId,
    homegateBaseUrl: homegate.HOMEGATE_URL.baseUrl,
    homegateOrigin: homegate.HOMEGATE_URL.origin,
  };
}

export function getBrowserBootstrapConfig(): BrowserBootstrapConfig {
  return parseBrowserBootstrapConfig(process.env);
}

function requiredString(name: string) {
  return z.string().trim().min(1, `${name} is required`);
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
