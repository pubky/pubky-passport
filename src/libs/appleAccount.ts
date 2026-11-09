import { isRecord } from "./typeGuards";

/**
 * The Apple Account behind an identity, kept only in this browser. The subject is
 * stable and team-scoped. Apple puts the email (possibly a private relay address) in every ID
 * token, but sends the name only once, on the first authorization; either may be missing.
 */
export type AppleAccount = Readonly<{
  appleSubject: string;
  email: string | null;
  name: string | null;
}>;

const APPLE_SUBJECT_CHARACTERS = 255;
const APPLE_EMAIL_CHARACTERS = 320;
const APPLE_NAME_CHARACTERS = 512;

export function isAppleSubject(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim() === value &&
    value.length <= APPLE_SUBJECT_CHARACTERS
  );
}

/** An email claim worth showing: a bounded, trimmed string with an `@`. */
export function isAppleEmail(value: unknown): value is string {
  return boundedTrimmed(value, APPLE_EMAIL_CHARACTERS) && value.includes("@");
}

export function isAppleName(value: unknown): value is string {
  return boundedTrimmed(value, APPLE_NAME_CHARACTERS);
}

export function isAppleAccount(value: unknown): value is AppleAccount {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 3 &&
    ["appleSubject", "email", "name"].every((key) => Object.hasOwn(value, key)) &&
    isAppleSubject(value.appleSubject) &&
    (value.email === null || isAppleEmail(value.email)) &&
    (value.name === null || isAppleName(value.name))
  );
}

function boundedTrimmed(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim() === value &&
    value.length <= maximum
  );
}
