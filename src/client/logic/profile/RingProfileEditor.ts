import type { ProfileController, ProfileResult } from "./ProfileController";
import type { RingProfileController } from "./RingProfileController";
import type { LoadedProfile, PubkyProfile } from "./profile";

/** Reads public profiles and publishes changes through the connected Ring grant. */
export class RingProfileEditor {
  constructor(
    private readonly profiles: Pick<ProfileController, "load">,
    private readonly ring: Pick<RingProfileController, "save">,
  ) {}

  load(publicKey: string): Promise<ProfileResult<LoadedProfile | null>> {
    return this.profiles.load(publicKey);
  }

  save(
    publicKey: string,
    profile: PubkyProfile,
    avatar?: File,
  ): Promise<ProfileResult<PubkyProfile>> {
    return this.ring.save(publicKey, profile, avatar);
  }
}
