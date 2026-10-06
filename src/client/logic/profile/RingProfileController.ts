import "client-only";
import { Result, type Result as ResultType } from "better-result";
import type { CodedFailure } from "@/libs/result";
import { LocalStorageIdentityRepository } from "../local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "../local-identity/localIdentityModels";
import { isPubkyPublicKey } from "../pubky/pubkyIdentityKey";
import {
  ProfileController,
  prepareProfilePublication,
  type ProfileResult,
} from "./ProfileController";
import type { PubkyProfile } from "./profile";
import type {
  PubkyProfileGrantErrorCode,
  PubkyRingProfileTransport,
  RingProfileGrant,
} from "../pubky/PubkySdkAdapter";

/**
 * Why a connection ended. Before Ring approves: `request_failed` (no request could be created),
 * `expired` and `cancelled`. After it approves: `homeserver_unresolved` (the approving pubky's
 * homeserver could not be looked up), `grant_rejected` (that homeserver refused the grant),
 * `missing_capabilities`, `wrong_identity` and `storage_failed`. `connection_failed` is any
 * other failure, such as a transport failure or a 404, which the SDK reports alike for the relay
 * (before approval) and for the homeserver (after it).
 */
export type RingConnectionErrorCode =
  | "cancelled"
  | "connection_failed"
  | "expired"
  | "grant_rejected"
  | "homeserver_unresolved"
  | "missing_capabilities"
  | "request_failed"
  | "storage_failed"
  | "wrong_identity";
type ConnectionResult<T> = ResultType<T, CodedFailure<RingConnectionErrorCode>>;
const CONNECTION_LIFETIME_MS = 5 * 60_000;
/** Whether the approving pubky has a published profile; `unknown` when the read failed. */
export type PublishedProfile = "none" | "published" | "unknown";

export type RingConnectionRequest = {
  /** Only this pubky may approve; set when editing a saved identity. */
  expectedKey?: string | undefined;
  /**
   * Saves the identity with profile setup pending until a profile is published, unless the
   * approving pubky has published one already: that account is not new, and its live profile is
   * kept rather than presented for setup.
   */
  setupRequired?: boolean | undefined;
  /**
   * Holds the approving pubky until {@link RingProfileController.confirm}. After a Ring signup
   * Passport cannot know the new key, so the person confirms that Ring connected that one.
   */
  confirmIdentity?: boolean | undefined;
};

/**
 * A poll outcome: still waiting, approved but not yet confirmed, or saved and connected.
 * `hasProfile` says whether the approved pubky already published a profile (then it is not a new
 * account), or `unknown` when that could not be read.
 */
export type RingConnectionProgress =
  | { status: "waiting" }
  | { status: "approved"; publicKeyZ32: string; hasProfile: PublishedProfile }
  | { status: "connected"; identity: LocalIdentityMetadata };

/**
 * Passport's profile grant is independent of any authorization request from a client app. It goes
 * through `relay`, the instance's configured HTTP relay (`PUBKY_HTTP_RELAY_URL`).
 */
export class RingProfileController {
  private connection: RingProfileGrant | undefined;
  private generation = 0;
  private deadline = 0;
  private expectedKey: string | undefined;
  private receivedKey: string | undefined;
  private connectedKey: string | undefined;
  private setupRequired = false;
  private publishedProfile: PublishedProfile | undefined;
  private confirmationRequired = false;
  private busy = false;

  constructor(
    private readonly relay: string,
    private readonly repository = new LocalStorageIdentityRepository(),
    private readonly transport?: Pick<PubkyRingProfileTransport, "start">,
    private readonly now: () => number = Date.now,
    private readonly profiles: Pick<ProfileController, "hasProfile"> = new ProfileController(),
  ) {}

  async start({
    expectedKey,
    setupRequired = false,
    confirmIdentity = false,
  }: RingConnectionRequest = {}): Promise<ConnectionResult<void>> {
    this.dispose();
    const generation = this.generation;
    if (expectedKey !== undefined && !isPubkyPublicKey(expectedKey))
      return Result.err({ code: "wrong_identity" });
    this.expectedKey = expectedKey;
    this.setupRequired = setupRequired;
    // An expected key is already bound, so there is nothing to confirm.
    this.confirmationRequired = confirmIdentity && expectedKey === undefined;
    let transport: Pick<PubkyRingProfileTransport, "start">;
    try {
      transport =
        this.transport ??
        new (await import("../pubky/PubkySdkAdapter")).PubkyRingProfileTransport();
    } catch (e) {
      return Result.err({ code: "request_failed", cause: e });
    }
    const connection = await transport.start(this.relay);
    if (Result.isError(connection)) {
      return Result.err({ code: "request_failed", cause: connection.error });
    }
    if (generation !== this.generation) {
      await connection.value.dispose();
      return Result.err({ code: "cancelled" });
    }
    this.connection = connection.value;
    this.deadline = this.now() + CONNECTION_LIFETIME_MS;
    return Result.ok();
  }

  authorizationUrl(): string | undefined {
    return !this.connectedKey && this.now() < this.deadline
      ? this.connection?.authorizationUrl()
      : undefined;
  }

  isConnected(publicKey?: string): boolean {
    return Boolean(
      this.connection &&
      this.connectedKey &&
      (publicKey === undefined || this.connectedKey === publicKey),
    );
  }

  /**
   * Checks once for Ring's approval. Nothing is saved while a confirmation is due. After
   * `storage_failed` the approved grant is kept, so polling again retries saving the identity
   * without a new approval in Ring.
   */
  async poll(): Promise<ConnectionResult<RingConnectionProgress>> {
    if (this.busy) return Result.ok({ status: "waiting" });
    const connection = this.connection;
    const generation = this.generation;
    if (!connection) return Result.err({ code: "cancelled" });
    if (this.receivedKey) return this.approved(this.receivedKey);
    if (this.now() >= this.deadline) {
      this.dispose();
      return Result.err({ code: "expired" });
    }
    this.busy = true;
    try {
      const polled = await connection.poll();
      if (generation !== this.generation) return Result.err({ code: "cancelled" });
      if (Result.isError(polled)) {
        this.dispose();
        return Result.err({ code: connectionFailure(polled.error.code), cause: polled.error });
      }
      const key = polled.value;
      if (this.now() >= this.deadline) {
        this.dispose();
        return Result.err({ code: "expired" });
      }
      if (!key) return Result.ok({ status: "waiting" });
      if (!isPubkyPublicKey(key) || (this.expectedKey && key !== this.expectedKey)) {
        this.dispose();
        return Result.err({ code: "wrong_identity" });
      }
      this.receivedKey = key;
      if (this.setupRequired) {
        this.publishedProfile = await this.readPublishedProfile(key);
        if (generation !== this.generation) return Result.err({ code: "cancelled" });
      }
      return this.approved(key);
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }

  /**
   * Saves the pubky Ring approved once the person confirmed that it is the one they meant. A
   * profile read that failed while polling is tried once more first.
   */
  async confirm(): Promise<ConnectionResult<LocalIdentityMetadata>> {
    const key = this.receivedKey;
    const generation = this.generation;
    if (!this.connection || !key || this.busy) return Result.err({ code: "cancelled" });
    if (this.setupRequired && this.publishedProfile === "unknown") {
      this.busy = true;
      try {
        this.publishedProfile = await this.readPublishedProfile(key);
      } finally {
        if (generation === this.generation) this.busy = false;
      }
      if (generation !== this.generation) return Result.err({ code: "cancelled" });
    }
    this.confirmationRequired = false;
    return this.remember(key);
  }

  /**
   * Setup is only for an account without a profile. A read that fails cannot tell and counts as
   * `unknown`, which still flags setup: the person confirmed the pubky as their new one, and the
   * setup form opens over whatever profile it can read.
   */
  private async readPublishedProfile(key: string): Promise<PublishedProfile> {
    const published = await this.profiles.hasProfile(key);
    if (Result.isError(published)) return "unknown";
    return published.value ? "published" : "none";
  }

  private approved(key: string): ConnectionResult<RingConnectionProgress> {
    if (this.confirmationRequired)
      return Result.ok({
        status: "approved",
        publicKeyZ32: key,
        hasProfile: this.publishedProfile ?? "unknown",
      });
    const saved = this.remember(key);
    return Result.isError(saved)
      ? Result.err(saved.error)
      : Result.ok({ status: "connected", identity: saved.value });
  }

  private remember(key: string): ConnectionResult<LocalIdentityMetadata> {
    const setupRequired = this.setupRequired && this.publishedProfile !== "published";
    const saved = this.repository.saveExternal(key, setupRequired);
    if (Result.isError(saved)) return Result.err({ code: "storage_failed", cause: saved.error });
    const identity = { ...saved.value };
    // A Ring identity saved earlier may still be flagged although its profile is live now.
    if (this.publishedProfile === "published" && identity.profileSetupRequired) {
      const completed = this.repository.completeProfileSetup(key);
      if (Result.isError(completed))
        return Result.err({ code: "storage_failed", cause: completed.error });
      delete identity.profileSetupRequired;
    }
    this.connectedKey = key;
    return Result.ok(identity);
  }

  async save(
    publicKey: string,
    input: PubkyProfile,
    avatar?: File,
  ): Promise<ProfileResult<PubkyProfile>> {
    if (this.busy) return Result.err({ code: "identity_unavailable" });
    const connection = this.connection;
    if (!connection || !this.isConnected(publicKey)) return Result.err({ code: "disconnected" });
    const catalog = this.repository.list();
    if (
      Result.isError(catalog) ||
      !catalog.value.identities.some(
        (identity) => identity.publicIdentity.publicKeyZ32 === publicKey,
      )
    )
      return Result.err({ code: "identity_unavailable" });
    this.busy = true;
    const generation = this.generation;
    try {
      const publication = await prepareProfilePublication(publicKey, input, avatar);
      if (Result.isError(publication)) return Result.err(publication.error);
      if (generation !== this.generation) return Result.err({ code: "cancelled" });
      const published = await connection.publish(publicKey, publication.value.writes);
      if (Result.isError(published)) {
        if (published.error.code !== "publish_unauthorized") {
          return Result.err({ code: "save_failed", cause: published.error });
        }
        // The grant was revoked; only a new approval in Ring can continue.
        if (generation === this.generation) this.dispose();
        return Result.err({ code: "disconnected", cause: published.error });
      }
      // The profile is live, so setup is complete even if the connection closed meanwhile.
      const completed = this.repository.completeProfileSetup(publicKey);
      if (generation !== this.generation) return Result.err({ code: "cancelled" });
      return Result.isError(completed)
        ? Result.err({ code: "storage_failed", cause: completed.error })
        : Result.ok(publication.value.profile);
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }

  dispose(): void {
    this.generation++;
    this.confirmationRequired = false;
    const connection = this.connection;
    this.connection = undefined;
    this.connectedKey = undefined;
    this.receivedKey = undefined;
    this.publishedProfile = undefined;
    this.busy = false;
    // Transport cleanup contains failures and waits for any active SDK operation.
    if (connection) void connection.dispose().catch(() => undefined);
  }
}

function connectionFailure(code: PubkyProfileGrantErrorCode): RingConnectionErrorCode {
  switch (code) {
    case "grant_rejected":
    case "homeserver_unresolved":
    case "missing_capabilities":
      return code;
    case "grant_busy":
    case "grant_failed":
      return "connection_failed";
  }
}
