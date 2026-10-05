import "client-only";

import { Result } from "better-result";

import { LOGGER } from "@/libs/logger/logger";
import type { SignupTokenStatus } from "@/client/logic/pubky/SignupTokenChecker";
import { sameInvite, type HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import { LocalAccountDraftRepository } from "./LocalAccountDraftRepository";

export type InviteDestination = "choose" | "ring" | "passport";

export type InviteDestinationErrorCode =
  | "invite_change_failed"
  | "invite_release_failed"
  | "invite_used"
  | "invite_redeemed"
  | "invite_not_found";

/**
 * Why the Passport key was dropped: the homeserver rejected its invite, the invite was submitted
 * and may already be redeemed, or it was never submitted.
 */
export type PassportAbandonReason = "invite_rejected" | "invite_submitted" | "user";

export type InviteDestinationState = {
  /** The saved setup could not be read. Its key is kept and nothing else is offered. */
  setupUnavailable: boolean;
  /** The unreadable setup is a damaged record the person may remove, not a storage failure. */
  setupRemovable: boolean;
  /** The invite bound to a saved, unfinished key. It outlives that key so Ring stays open. */
  resumedInvite: HomeserverSignupDetails | null;
  manualEntry: "closed" | "open" | "submitted";
  manualInvite: HomeserverSignupDetails | null;
  destination: InviteDestination;
  /** Once submitted with the Passport key, the invite may own that account; Ring stays closed. */
  registrationStarted: boolean;
  /** Ring may have redeemed an invite it was shown, so Passport checks it before reuse. */
  sharedWithRing: boolean;
  /** The invite the homeserver last reported used. Only Ring's profile step remains for it. */
  usedInvite: HomeserverSignupDetails | null;
  /**
   * A submitted invite whose key was dropped before a lookup proved it unused; both signers
   * look it up again before using it.
   */
  inviteToRecheck: HomeserverSignupDetails | null;
  checkingInvite: boolean;
  error: InviteDestinationErrorCode | null;
};

type DraftPort = Pick<LocalAccountDraftRepository, "discardUnregistered" | "read">;
type SavedSetup = ReturnType<LocalAccountDraftRepository["read"]>;
type SignupTokenCheck = (
  invite: HomeserverSignupDetails,
  signal: AbortSignal,
) => Promise<SignupTokenStatus>;

const FORGOTTEN_INVITE = {
  resumedInvite: null,
  manualInvite: null,
  manualEntry: "closed",
  sharedWithRing: false,
  usedInvite: null,
  inviteToRecheck: null,
  registrationStarted: false,
} satisfies Partial<InviteDestinationState>;

/** A saved setup's invite comes first, then a submitted manual invite, then Homegate's. */
export function selectedInvite(
  state: InviteDestinationState,
  homegateInvite: HomeserverSignupDetails | null,
): HomeserverSignupDetails | null {
  return (
    state.resumedInvite ??
    (state.manualEntry === "submitted" ? state.manualInvite : null) ??
    homegateInvite
  );
}

/**
 * Decides where a new account's key lives once an invite exists: in Pubky Ring or in this
 * browser. It keeps one unsubmitted Passport key per invite and never hands an invite to a
 * second signer after the homeserver may have consumed it.
 */
export class InviteDestinationController {
  private state: InviteDestinationState;
  private readonly listeners = new Set<() => void>();
  private check: AbortController | null = null;

  /** @param saved The unfinished setup, as `readUnfinishedAccount` returns it. */
  constructor(
    saved: SavedSetup,
    private readonly checkSignupToken: SignupTokenCheck,
    private readonly drafts: DraftPort = new LocalAccountDraftRepository(),
  ) {
    const draft = Result.isOk(saved) ? saved.value : null;
    this.state = {
      setupUnavailable: Result.isError(saved),
      setupRemovable: Result.isError(saved) && saved.error.code === "invalid_draft",
      resumedInvite: draft?.invite ?? null,
      manualEntry: "closed",
      manualInvite: null,
      destination: "choose",
      registrationStarted: draft?.registrationStarted === true,
      sharedWithRing: false,
      usedInvite: null,
      inviteToRecheck: null,
      checkingInvite: false,
      error: null,
    };
  }

  getState(): InviteDestinationState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Cancels a running invite check; its late answer is ignored. */
  dispose(): void {
    this.cancelCheck();
  }

  openInviteEntry(): void {
    this.cancelCheck();
    this.update({ manualEntry: "open", destination: "choose", error: null });
  }

  closeInviteEntry(): void {
    this.update({ manualEntry: "closed", error: null });
  }

  /** Accepts a manual invite. A saved key bound to another invite is released first. */
  submitInvite(invite: HomeserverSignupDetails): void {
    const saved = this.drafts.read();
    const changed =
      Result.isOk(saved) && saved.value !== null && !sameInvite(saved.value.invite, invite);
    if (Result.isError(saved) || (changed && Result.isError(this.drafts.discardUnregistered()))) {
      this.update({ error: "invite_change_failed" });
      return;
    }
    const { manualInvite, resumedInvite } = this.state;
    const replacesResumed =
      changed || (resumedInvite !== null && !sameInvite(resumedInvite, invite));
    this.update({
      ...(replacesResumed ? { resumedInvite: null, registrationStarted: false } : {}),
      ...(manualInvite && sameInvite(manualInvite, invite) ? {} : { sharedWithRing: false }),
      manualInvite: invite,
      manualEntry: "submitted",
      destination: "choose",
      error: null,
    });
  }

  /**
   * Opens the Ring signup and releases an unsubmitted Passport key; the invite then belongs to
   * Ring. An invite restored from an earlier visit (`recheck`) is looked up first: a `not_found`
   * answer blocks it, and a `used` one leaves only Ring's profile step. An invite a dropped
   * Passport key submitted is looked up too, and a `used` answer blocks it, since Ring never
   * held it. Resolves the status of that lookup, or `null` when none finished.
   */
  async chooseRing(
    invite: HomeserverSignupDetails,
    recheck = false,
  ): Promise<SignupTokenStatus | null> {
    this.cancelCheck();
    const { usedInvite } = this.state;
    const submitted = this.submittedBeforeDrop(invite);
    let status: SignupTokenStatus | null = null;
    if (submitted || (recheck && !(usedInvite && sameInvite(usedInvite, invite)))) {
      status = await this.lookUp(invite);
      if (status === null) return null;
      if (status === "not_found" || (submitted && status === "used")) {
        this.update({ checkingInvite: false, error: blockingError(status, submitted) });
        return status;
      }
    }
    const used = status === "used" ? { usedInvite: invite } : {};
    const checked = status === "valid" ? { inviteToRecheck: null } : {};
    if (Result.isError(this.drafts.discardUnregistered())) {
      this.update({ ...used, ...checked, checkingInvite: false, error: "invite_release_failed" });
      return status;
    }
    this.update({
      ...used,
      ...checked,
      checkingInvite: false,
      sharedWithRing: true,
      destination: "ring",
      error: null,
    });
    return status;
  }

  /**
   * Opens the Passport key flow. An invite Ring was shown, one restored from an earlier visit
   * (`recheck`), or one a dropped Passport key submitted is looked up first; only `used` and
   * `not_found` answers block it. Resolves the status of that lookup, or `null` when none
   * finished.
   */
  async choosePassport(
    invite: HomeserverSignupDetails,
    recheck = false,
  ): Promise<SignupTokenStatus | null> {
    if (this.check) return null;
    const { registrationStarted, sharedWithRing } = this.state;
    const submitted = this.submittedBeforeDrop(invite);
    if (registrationStarted || (!sharedWithRing && !recheck && !submitted)) {
      this.update({ destination: "passport", error: null });
      return null;
    }
    const status = await this.lookUp(invite);
    if (status === null) return null;
    if (status === "used" || status === "not_found") {
      this.update({
        // Only Ring can have used an invite no Passport key submitted.
        ...(status === "used" && !submitted ? { usedInvite: invite } : {}),
        checkingInvite: false,
        error: blockingError(status, submitted),
      });
      return status;
    }
    this.update({
      ...(status === "valid" ? { inviteToRecheck: null } : {}),
      checkingInvite: false,
      destination: "passport",
      error: null,
    });
    return status;
  }

  returnToChoice(): void {
    this.update({ destination: "choose" });
  }

  /** Back from the Passport key flow; a started registration keeps Ring closed. */
  leavePassport(): void {
    const saved = this.drafts.read();
    this.update({
      registrationStarted: Result.isError(saved) || saved.value?.registrationStarted === true,
      destination: "choose",
    });
  }

  /**
   * The Passport key was dropped. A rejected invite is offered neither to a new key nor Ring. A
   * submitted one may have been redeemed before its key was dropped, so it is looked up: `used`
   * and `not_found` answers forget it. Until a lookup finds it `valid`, both signers look it up
   * again before using it. Resolves the status of that lookup, or `null` when none finished.
   */
  async abandonPassport(
    reason: PassportAbandonReason,
    invite: HomeserverSignupDetails,
  ): Promise<SignupTokenStatus | null> {
    if (reason === "invite_rejected") {
      this.update(FORGOTTEN_INVITE);
      return null;
    }
    if (reason === "user") {
      this.update({ registrationStarted: false });
      return null;
    }
    this.cancelCheck();
    // Set first, so a lookup cancelled meanwhile still leaves the invite to be checked.
    this.update({ registrationStarted: false, inviteToRecheck: invite });
    const status = await this.lookUp(invite);
    if (status === null) return null;
    if (status === "used" || status === "not_found") {
      this.update({ ...FORGOTTEN_INVITE, checkingInvite: false });
      return status;
    }
    this.update({
      ...(status === "valid" ? { inviteToRecheck: null } : {}),
      checkingInvite: false,
    });
    return status;
  }

  /**
   * Forgets the invite in play and any unsubmitted key bound to it. Returns false, keeping
   * both, when the saved key cannot be released.
   */
  discardInvite(): boolean {
    this.cancelCheck();
    if (Result.isError(this.drafts.discardUnregistered())) {
      this.update({ error: "invite_release_failed" });
      return false;
    }
    this.update({ ...FORGOTTEN_INVITE, destination: "choose", error: null });
    return true;
  }

  /** Leaving account creation drops an unsubmitted key; the invite stays with its source. */
  exit(): void {
    this.cancelCheck();
    const discarded = this.drafts.discardUnregistered();
    if (Result.isError(discarded)) {
      LOGGER.info("signup.exit.draft_kept", { code: discarded.error.code });
    }
  }

  /** True while `invite` is the one a dropped Passport key submitted and no lookup cleared. */
  private submittedBeforeDrop(invite: HomeserverSignupDetails): boolean {
    const { inviteToRecheck } = this.state;
    return inviteToRecheck !== null && sameInvite(inviteToRecheck, invite);
  }

  /**
   * Looks the invite up on its homeserver and leaves `checkingInvite` set for the caller to
   * clear. Resolves `null` when the lookup was cancelled meanwhile.
   */
  private async lookUp(invite: HomeserverSignupDetails): Promise<SignupTokenStatus | null> {
    const check = new AbortController();
    this.check = check;
    this.update({ checkingInvite: true, error: null });
    const status = await this.checkSignupToken(invite, check.signal);
    if (check.signal.aborted) return null;
    this.check = null;
    return status;
  }

  private cancelCheck(): void {
    if (!this.check) return;
    this.check.abort();
    this.check = null;
    this.update({ checkingInvite: false });
  }

  private update(patch: Partial<InviteDestinationState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** The error for a lookup that blocks an invite; `submitted` names one a Passport key used. */
function blockingError(
  status: "used" | "not_found",
  submitted: boolean,
): InviteDestinationErrorCode {
  if (status === "not_found") return "invite_not_found";
  return submitted ? "invite_redeemed" : "invite_used";
}
