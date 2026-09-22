import { isRecord } from "./typeGuards";

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

type ValidGoogleUserInfo = {
  email: string;
  name: string;
  picture?: string;
  sub: string;
};

/**
 * Converts an untrusted Google UserInfo response into the profile stored by Passport.
 * Returns null when its fields are invalid or its subject does not match the ID-token subject.
 */
export function googleAccountProfileFromUserInfo(
  userInfo: unknown,
  expectedGoogleSubject: string,
): GoogleAccountProfile | null {
  if (!isRecord(userInfo)) return null;

  if (!hasValidGoogleUserInfoFields(userInfo)) return null;

  const hasExpectedSubject = userInfo.sub === expectedGoogleSubject;
  if (!hasExpectedSubject) {
    return null;
  }

  return Object.freeze({
    googleSubject: userInfo.sub,
    email: userInfo.email,
    name: userInfo.name,
    pictureUrl: externalGooglePictureUrl(userInfo.picture),
  });
}

export function isGoogleAccountProfile(value: unknown): value is GoogleAccountProfile {
  if (!isRecord(value)) return false;

  const hasExpectedShape = hasExactKeys(value, ["googleSubject", "email", "name", "pictureUrl"]);
  const hasRequiredProfileFields =
    boundedString(value.googleSubject, GOOGLE_SUBJECT_CHARACTERS) &&
    boundedString(value.email, GOOGLE_EMAIL_CHARACTERS) &&
    boundedString(value.name, GOOGLE_NAME_CHARACTERS);
  if (!hasExpectedShape || !hasRequiredProfileFields) {
    return false;
  }
  return (
    value.pictureUrl === null ||
    externalGooglePictureUrl(value.pictureUrl) !== null ||
    isLocalGoogleAvatar(value.pictureUrl)
  );
}

function hasValidGoogleUserInfoFields(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ValidGoogleUserInfo {
  const hasRequiredProfileFields =
    boundedString(value.sub, GOOGLE_SUBJECT_CHARACTERS) &&
    boundedString(value.email, GOOGLE_EMAIL_CHARACTERS) &&
    boundedString(value.name, GOOGLE_NAME_CHARACTERS);
  const hasValidPicture =
    value.picture === undefined || boundedString(value.picture, GOOGLE_PICTURE_URL_CHARACTERS);
  return hasRequiredProfileFields && hasValidPicture;
}

function externalGooglePictureUrl(value: unknown): string | null {
  if (!boundedString(value, GOOGLE_PICTURE_URL_CHARACTERS)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "lh3.googleusercontent.com" &&
      !url.username &&
      !url.password &&
      !url.hash
      ? value
      : null;
  } catch {
    return null;
  }
}

function isLocalGoogleAvatar(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= LOCAL_AVATAR_CHARACTERS &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)
  );
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
