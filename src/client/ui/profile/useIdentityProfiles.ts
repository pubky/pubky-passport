import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import { ProfileLoadQueue } from "@/client/logic/profile/ProfileLoadQueue";
import type { ProfileIdentity, PubkyProfile } from "@/client/logic/profile/profile";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";

/**
 * Loads public profiles on demand: the active identity's straight away unless `loadActive` is off
 * (a request's identity list, where nothing is chosen yet), the others only after {@link loadAll}
 * (the switcher is open). Fetching every saved identity on each visit would let PKARR relays and
 * shared homeservers link identities that a user keeps apart. Until an identity's profile is read,
 * it shows the summary this browser kept from its last read. Refetches one identity after it
 * publishes, and releases avatar object URLs as identities leave the catalog.
 */
export function useIdentityProfiles(
  catalog: LocalIdentityCatalog,
  { loadActive = true }: { loadActive?: boolean } = {},
) {
  const { createProfileController } = usePassportCollaborators();
  const [controller] = useState(createProfileController);
  const [profiles, setProfiles] = useState<Record<string, ProfileIdentity>>({});
  const [showAll, setShowAll] = useState(false);
  const avatarUrls = useRef(new Map<string, string>());
  const queue = useRef<ProfileLoadQueue>(undefined);
  useEffect(() => {
    const urls = avatarUrls.current;
    const loads = new ProfileLoadQueue(
      (publicKey) => controller.load(publicKey),
      (publicKey, loaded) => {
        const avatarUrl = loaded?.avatar ? URL.createObjectURL(loaded.avatar) : undefined;
        releaseAvatar(urls, publicKey);
        if (avatarUrl) urls.set(publicKey, avatarUrl);
        setProfiles((previous) => ({
          ...previous,
          [publicKey]: loaded ? { profile: loaded.profile, avatarUrl } : {},
        }));
      },
    );
    queue.current = loads;
    return () => {
      loads.dispose();
      queue.current = undefined;
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, [controller]);
  const keys = catalog.identities
    .map((identity) => identity.publicIdentity.publicKeyZ32)
    .sort()
    .join(",");
  const active = catalog.activePublicKeyZ32;
  useEffect(() => {
    const current = new Set(keys.split(",").filter(Boolean));
    const dropped = new Set(queue.current?.retain(current));
    for (const key of avatarUrls.current.keys()) if (!current.has(key)) dropped.add(key);
    for (const key of dropped) releaseAvatar(avatarUrls.current, key);
    if (dropped.size) {
      setProfiles((previous) => {
        const next = { ...previous };
        for (const key of dropped) delete next[key];
        return next;
      });
    }
    queue.current?.request(
      showAll ? current : loadActive && active && current.has(active) ? [active] : [],
    );
  }, [keys, active, showAll, loadActive, controller]);

  return {
    controller,
    /** Loads every identity in the catalog, for screens that list them all. */
    loadAll: useCallback(() => setShowAll(true), []),
    published: (key: string, profile: PubkyProfile, avatar?: File) => {
      const avatarUrl = avatar ? URL.createObjectURL(avatar) : undefined;
      if (avatarUrl || !profile.image) {
        releaseAvatar(avatarUrls.current, key);
        if (avatarUrl) avatarUrls.current.set(key, avatarUrl);
      }
      setProfiles((previous) => ({
        ...previous,
        [key]: {
          profile,
          avatarUrl: avatarUrl ?? (profile.image ? previous[key]?.avatarUrl : undefined),
        },
      }));
      // Only the published identity is read back; loads of the others continue undisturbed.
      queue.current?.refresh(key);
    },
    catalog: {
      ...catalog,
      identities: catalog.identities.map((identity) => {
        const read = profiles[identity.publicIdentity.publicKeyZ32];
        if (read) return { ...identity, ...read };
        const summary = identity.profileSummary;
        return summary
          ? { ...identity, profile: { name: summary.name }, avatarUrl: summary.avatar }
          : identity;
      }),
    },
  };
}

function releaseAvatar(avatarUrls: Map<string, string>, key: string): void {
  const url = avatarUrls.get(key);
  if (url) URL.revokeObjectURL(url);
  avatarUrls.delete(key);
}
