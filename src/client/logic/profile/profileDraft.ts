import { Result } from "better-result";
import type { PubkyProfile } from "./profile";
import {
  checkLinkUrls,
  PROFILE_LIMITS,
  type LinkUrlCheck,
  type ProfileSpecsResult,
} from "./ProfileSpecsAdapter";

export type ProfileLinkField = { id: number; title: string; url: string; fixedTitle: boolean };
export type ProfileDraft = {
  name: string;
  bio: string;
  links: ProfileLinkField[];
  image: string | null;
  status: string | null;
};

/** Edits not published yet: the form's draft and an avatar chosen for it. */
export type UnsavedProfileEdits = { draft: ProfileDraft; avatar?: File | undefined };

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

/** An id no link of `draft` has, for a link added to it. Published links take the first ones. */
export function nextLinkId(draft: ProfileDraft): number {
  return Math.max(PROFILE_LIMITS.linksMaxCount, ...draft.links.map((link) => link.id + 1));
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
 * Whether saving `draft` would publish something other than `saved`, the draft the editor opened
 * with. Only what would be published counts: an empty link row, or spaces around an address, do
 * not make a change worth confirming before it is thrown away.
 */
export function profileDraftChanged(draft: ProfileDraft, saved: ProfileDraft): boolean {
  return JSON.stringify(profileFromDraft(draft)) !== JSON.stringify(profileFromDraft(saved));
}

/** What the specs make of each address a draft would publish, keyed by that address. */
export type LinkUrlChecks = ReadonlyMap<string, LinkUrlCheck>;

/**
 * Asks the specs about every address `draft` would publish. They are the only judge of a link, so
 * any scheme a profile may carry (`https:`, `mailto:`, `pubky:`, …) is accepted, and a link read
 * from a published profile is never refused. Passport opens none of them; see `profileLinkHref`.
 */
export async function checkDraftLinks(
  draft: ProfileDraft,
): Promise<ProfileSpecsResult<LinkUrlChecks>> {
  const urls = new Set(draft.links.map(linkUrl).filter(Boolean));
  const checks = await checkLinkUrls([...urls]);
  return Result.isError(checks)
    ? checks
    : Result.ok(new Map(checks.value.map((check) => [check.url, check])));
}

/**
 * A link address's length as typed (trimmed) and as the specs measure it once stored, which can
 * differ: a space is stored as `%20`. Null when `checks` has no answer for the address.
 */
export function linkUrlLength(
  link: ProfileLinkField,
  checks: LinkUrlChecks,
): { typed: number; stored: number } | null {
  const url = linkUrl(link);
  const check = checks.get(url);
  return check ? { typed: [...url].length, stored: [...check.stored].length } : null;
}

/**
 * Checks each field against the pinned specs release's limits, and each link address by the specs'
 * own answer in `links` (from {@link checkDraftLinks}), so the form can point at the one to fix
 * before anything is published. The specs WASM still validates the document it writes.
 */
export function validateProfileDraft(
  draft: ProfileDraft,
  links: LinkUrlChecks,
): ProfileFieldErrors {
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
    // An address the specs were not asked about is left to their check of the whole document.
    const check = links.get(linkUrl(link));
    if (check && [...check.stored].length > PROFILE_LIMITS.linkUrlMaxLength)
      errors[linkFieldKey(link.id, "url")] = "link_url_too_long";
    else if (check && !check.accepted) errors[linkFieldKey(link.id, "url")] = "link_url_invalid";
  }
  return errors;
}
