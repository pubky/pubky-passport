import { invalidOption } from "./PassportConfigError.js";

// Matches UNSAFE_SOURCE_CHARACTERS in authorization/request/parser/pubkyAuthRequestParser.ts.
export const UNSAFE_NAME =
  /[\p{Cc}\p{Zl}\p{Zp}\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;

export function resolveAppName(input: string): string {
  const name = input.trim().normalize("NFC");
  if (!name || name.length > 128 || UNSAFE_NAME.test(name))
    invalidOption(
      "appName",
      "Use a name of 1–128 characters without control or bidirectional/zero-width space characters.",
    );
  return name;
}

export function validateClientId(input: string): string {
  const bytes = new TextEncoder().encode(input).length;
  if (bytes < 1 || bytes > 253) invalidOption("clientId", "Use a client ID of 1–253 UTF-8 bytes.");
  return input;
}
