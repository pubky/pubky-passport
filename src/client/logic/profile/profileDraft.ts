import type { PubkyProfile } from "./profile";
import { PROFILE_LIMITS } from "./ProfileSpecsAdapter";

export type ProfileLinkField = { id: number; title: string; url: string; fixedTitle: boolean };
export type ProfileDraft = {
  name: string;
  bio: string;
  links: ProfileLinkField[];
  image: string | null;
  status: string | null;
};

/** A form control a draft can be refused for: a link's controls are named by the link's `id`. */
export type ProfileFieldKey = "name" | "bio" | `link-${number}-title` | `link-${number}-url`;
export type ProfileFieldErrorCode =
  | "name_length"
  | "bio_too_long"
  | "link_title_missing"
  | "link_title_too_long"
  | "link_url_invalid"
  | "link_url_too_long";
/** Refused fields in the order the form shows them: name, bio, then each link's title and URL. */
export type ProfileFieldErrors = Partial<Record<ProfileFieldKey, ProfileFieldErrorCode>>;

const WEBSITE = "Website";
export const X_TWITTER = "X (Twitter)";
const X_HANDLE = /^@?[a-zA-Z0-9_]{1,15}$/;

export const linkFieldKey = (id: number, part: "title" | "url"): ProfileFieldKey =>
  `link-${id}-${part}`;

/**
 * A text field's length as pubky-app-specs measures it: trimmed, in Unicode scalar values rather
 * than UTF-16 units, so a name of 50 emoji is within its limit.
 */
export function profileTextLength(value: string): number {
  return [...value.trim()].length;
}

/** Editable form state for a published profile, or an empty form that suggests `fallbackName`. */
export function draftFromProfile(
  profile: PubkyProfile | undefined,
  fallbackName: string,
): ProfileDraft {
  return {
    name: profile?.name ?? fallbackName,
    bio: profile?.bio ?? "",
    links: profile?.links?.length
      ? profile.links.map((link, id) => ({
          ...link,
          id,
          fixedTitle: link.title === WEBSITE || link.title === X_TWITTER,
        }))
      : [
          { id: 0, title: WEBSITE, url: "", fixedTitle: true },
          { id: 1, title: X_TWITTER, url: "", fixedTitle: true },
        ],
    image: profile?.image ?? null,
    status: profile?.status ?? null,
  };
}

/** The URL a link publishes: trimmed, with a bare X handle expanded to its profile address. */
function linkUrl({ title, url }: ProfileLinkField): string {
  const value = url.trim();
  return title === X_TWITTER && X_HANDLE.test(value)
    ? `https://x.com/${value.replace(/^@/, "")}`
    : value;
}

/** The profile a draft publishes: empty links are dropped and a bare X handle becomes its URL. */
export function profileFromDraft(draft: ProfileDraft): PubkyProfile {
  return {
    name: draft.name,
    bio: draft.bio || null,
    image: draft.image,
    status: draft.status,
    links: draft.links
      .filter((link) => link.url.trim())
      .map((link) => ({ title: link.title, url: linkUrl(link) })),
  };
}

/**
 * The address the specs store for a link, normalised the way `URL` does, or null when it is not a
 * web address without credentials (security invariant 9). The specs WASM alone would accept any
 * scheme, so `localhost:3000` or `javascript:` would be published as a broken link. Plain `http:`
 * stays allowed: a profile link is only published for others to open, never fetched by Passport.
 */
function storedLinkUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const web = url.protocol === "https:" || url.protocol === "http:";
  return web && !url.username && !url.password ? url.href : null;
}

/**
 * A link address's length as typed (trimmed) and as the specs measure it once stored, which can
 * differ: a space is stored as `%20`. Null when the address is not a plain web address.
 */
export function linkUrlLength(link: ProfileLinkField): { typed: number; stored: number } | null {
  const url = linkUrl(link);
  const stored = url ? storedLinkUrl(url) : null;
  return stored === null ? null : { typed: [...url].length, stored: [...stored].length };
}

/**
 * Checks each field against the pinned specs release's limits, so the form can point at the one
 * to fix before anything is published. The specs WASM still validates the document it writes.
 */
export function validateProfileDraft(draft: ProfileDraft): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};
  const name = profileTextLength(draft.name);
  if (name < PROFILE_LIMITS.nameMinLength || name > PROFILE_LIMITS.nameMaxLength)
    errors.name = "name_length";
  if (profileTextLength(draft.bio) > PROFILE_LIMITS.bioMaxLength) errors.bio = "bio_too_long";
  for (const link of draft.links) {
    // A link without a URL is left out of the profile, so its title does not matter.
    if (!linkUrl(link)) continue;
    const title = profileTextLength(link.title);
    if (title === 0) errors[linkFieldKey(link.id, "title")] = "link_title_missing";
    else if (title > PROFILE_LIMITS.linkTitleMaxLength)
      errors[linkFieldKey(link.id, "title")] = "link_title_too_long";
    const url = linkUrlLength(link);
    if (url === null) errors[linkFieldKey(link.id, "url")] = "link_url_invalid";
    else if (url.stored > PROFILE_LIMITS.linkUrlMaxLength)
      errors[linkFieldKey(link.id, "url")] = "link_url_too_long";
  }
  return errors;
}
