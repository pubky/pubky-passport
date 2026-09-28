import type { PubkyProfile } from "./profile";

export type ProfileLinkField = { id: number; title: string; url: string; fixedTitle: boolean };
export type ProfileDraft = {
  name: string;
  bio: string;
  links: ProfileLinkField[];
  image: string | null;
  status: string | null;
};

const WEBSITE = "Website";
const X_TWITTER = "X (Twitter)";
const X_HANDLE = /^@?[a-zA-Z0-9_]{1,15}$/;

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

/** The profile a draft publishes: empty links are dropped and a bare X handle becomes its URL. */
export function profileFromDraft(draft: ProfileDraft): PubkyProfile {
  return {
    name: draft.name,
    bio: draft.bio || null,
    image: draft.image,
    status: draft.status,
    links: draft.links
      .filter((link) => link.url.trim())
      .map(({ title, url }) => {
        const value = url.trim();
        return {
          title,
          url:
            title === X_TWITTER && X_HANDLE.test(value)
              ? `https://x.com/${value.replace(/^@/, "")}`
              : value,
        };
      }),
  };
}
