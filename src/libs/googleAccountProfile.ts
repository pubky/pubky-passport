export type GoogleAccountProfile = Readonly<{
  googleSubject: string;
  email: string;
  name: string;
  pictureUrl: string | null;
}>;

const GOOGLE_SUBJECT_CHARACTERS = 255;
const GOOGLE_EMAIL_CHARACTERS = 320;
const GOOGLE_NAME_CHARACTERS = 512;
const GOOGLE_PICTURE_URL_CHARACTERS = 2_048;
const LOCAL_AVATAR_CHARACTERS = 512 * 1024;

export function googleAccountProfileFromUserInfo(
  value: unknown,
  expectedGoogleSubject: string,
): GoogleAccountProfile | null {
  if (!isRecord(value)
    || !boundedString(value.sub, GOOGLE_SUBJECT_CHARACTERS)
    || value.sub !== expectedGoogleSubject
    || !boundedString(value.email, GOOGLE_EMAIL_CHARACTERS)
    || !boundedString(value.name, GOOGLE_NAME_CHARACTERS)
    || (value.picture !== undefined
      && !boundedString(value.picture, GOOGLE_PICTURE_URL_CHARACTERS))) return null;

  return Object.freeze({
    googleSubject: value.sub,
    email: value.email,
    name: value.name,
    pictureUrl: externalGooglePictureUrl(value.picture),
  });
}

export function isGoogleAccountProfile(value: unknown): value is GoogleAccountProfile {
  if (!isRecord(value)
    || !hasExactKeys(value, ["googleSubject", "email", "name", "pictureUrl"])
    || !boundedString(value.googleSubject, GOOGLE_SUBJECT_CHARACTERS)
    || !boundedString(value.email, GOOGLE_EMAIL_CHARACTERS)
    || !boundedString(value.name, GOOGLE_NAME_CHARACTERS)) return false;
  return value.pictureUrl === null
    || externalGooglePictureUrl(value.pictureUrl) !== null
    || isLocalGoogleAvatar(value.pictureUrl);
}

function externalGooglePictureUrl(value: unknown): string | null {
  if (!boundedString(value, GOOGLE_PICTURE_URL_CHARACTERS)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "lh3.googleusercontent.com"
      && !url.username
      && !url.password
      && !url.hash
      ? value
      : null;
  } catch {
    return null;
  }
}

function isLocalGoogleAvatar(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= LOCAL_AVATAR_CHARACTERS
    && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
