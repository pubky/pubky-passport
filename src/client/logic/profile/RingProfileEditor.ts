import type { ProfileController, ProfileResult } from "./ProfileController";
import type { RingProfileController } from "./RingProfileController";
import type { LoadedProfile, PubkyProfile } from "./profile";
import type { UnsavedProfileEdits } from "./profileDraft";

/**
 * Reads public profiles and publishes changes through the connected Ring grant. When the grant
 * ends before a save, the unpublished edits are kept here, in memory only, while Ring is connected
 * again, so the editor can reopen with them instead of the published profile. One editor is open
 * at a time, so one identity's edits are kept.
 */
export class RingProfileEditor {
  private kept: { publicKey: string; edits: UnsavedProfileEdits } | undefined;

  constructor(
    private readonly profiles: Pick<ProfileController, "load" | "checkAvatar">,
    private readonly ring: Pick<RingProfileController, "save">,
  ) {}

  load(publicKey: string): Promise<ProfileResult<LoadedProfile | null>> {
    return this.profiles.load(publicKey);
  }

  checkAvatar(file: File): Promise<ProfileResult<void>> {
    return this.profiles.checkAvatar(file);
  }

  save(
    publicKey: string,
    profile: PubkyProfile,
    avatar?: File,
  ): Promise<ProfileResult<PubkyProfile>> {
    return this.ring.save(publicKey, profile, avatar);
  }

  /** Keeps `publicKey`'s unpublished edits while Ring is reconnected. */
  keepEdits(publicKey: string, edits: UnsavedProfileEdits): void {
    this.kept = { publicKey, edits };
  }

  keptEdits(publicKey: string): UnsavedProfileEdits | undefined {
    return this.kept?.publicKey === publicKey ? this.kept.edits : undefined;
  }

  /**
   * Drops kept edits unless they are `editing`'s, the identity whose editor (or its Ring
   * connection) is open: they last only until the person leaves it, saves, or discards them.
   */
  forgetEditsExcept(editing: string | undefined): void {
    if (this.kept?.publicKey !== editing) this.kept = undefined;
  }
}
