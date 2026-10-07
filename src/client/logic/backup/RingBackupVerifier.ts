import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { CodedFailure } from "@/libs/result";
import { LocalStorageIdentityRepository } from "../local-identity/LocalStorageIdentityRepository";
import type { KeychainAuthMethod } from "../pubky/keychainAuthMethod";
import { isPubkyPublicKey } from "../pubky/pubkyIdentityKey";
import type {
  PubkyProfileGrantErrorCode,
  PubkyRingVerificationTransport,
  RingProfileGrant,
} from "../pubky/PubkySdkAdapter";

/**
 * Why a verification ended. Before Ring approves: `request_failed` (no request could be created),
 * `expired` and `cancelled`. After it approves: `wrong_identity` (Ring signed with another pubky),
 * `homeserver_unresolved`, `grant_rejected` and `storage_failed` (the check could not be saved).
 * `connection_failed` is any other failure, which the SDK reports alike for the relay and the
 * homeserver.
 */
export type RingVerificationErrorCode =
  | "cancelled"
  | "connection_failed"
  | "expired"
  | "grant_rejected"
  | "homeserver_unresolved"
  | "request_failed"
  | "storage_failed"
  | "wrong_identity";
type VerificationResult<T> = ResultType<T, CodedFailure<RingVerificationErrorCode>>;

/** A poll outcome: still waiting, or verified (and recorded) at `at`. */
export type RingVerificationProgress = { status: "waiting" } | { status: "verified"; at: Date };

const VERIFICATION_LIFETIME_MS = 5 * 60_000;

/**
 * Checks that Pubky Ring holds a key saved in this browser, as opening a recovery file checks the
 * file: Ring is asked to approve a sign-in that grants nothing, and the approval counts only when
 * Ring signed it with that key. The Session it yields is signed out as soon as the key is read and
 * is never stored or written with. A match is recorded as the key's Ring verification; anything
 * else records nothing. Requests go through `relay`, the instance's configured HTTP relay.
 */
export class RingBackupVerifier {
  private connection: RingProfileGrant | undefined;
  private generation = 0;
  private deadline = 0;
  private expectedKey: string | undefined;
  private busy = false;

  constructor(
    private readonly relay: string,
    private readonly repository: Pick<
      LocalStorageIdentityRepository,
      "recordBackup"
    > = new LocalStorageIdentityRepository(),
    private readonly transport?: Pick<PubkyRingVerificationTransport, "start">,
    private readonly now: () => number = Date.now,
  ) {}

  /** `method` `cookie` asks the legacy way, for Pubky Ring older than 2.0. */
  async start(
    expectedKey: string,
    method: KeychainAuthMethod = "grant",
  ): Promise<VerificationResult<void>> {
    this.dispose();
    const generation = this.generation;
    if (!isPubkyPublicKey(expectedKey)) return Result.err({ code: "wrong_identity" });
    this.expectedKey = expectedKey;
    let transport: Pick<PubkyRingVerificationTransport, "start">;
    try {
      transport =
        this.transport ??
        new (await import("../pubky/PubkySdkAdapter")).PubkyRingVerificationTransport();
    } catch (e) {
      return Result.err({ code: "request_failed", cause: e });
    }
    const connection = await transport.start(this.relay, method);
    if (Result.isError(connection)) {
      return Result.err({ code: "request_failed", cause: connection.error });
    }
    if (generation !== this.generation) {
      await connection.value.dispose();
      return Result.err({ code: "cancelled" });
    }
    this.connection = connection.value;
    this.deadline = this.now() + VERIFICATION_LIFETIME_MS;
    return Result.ok();
  }

  authorizationUrl(): string | undefined {
    return this.now() < this.deadline ? this.connection?.authorizationUrl() : undefined;
  }

  /** Checks once for Ring's approval; the first approval ends the verification either way. */
  async poll(): Promise<VerificationResult<RingVerificationProgress>> {
    if (this.busy) return Result.ok({ status: "waiting" });
    const connection = this.connection;
    const expectedKey = this.expectedKey;
    const generation = this.generation;
    if (!connection || !expectedKey) return Result.err({ code: "cancelled" });
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
        return Result.err({ code: verificationFailure(polled.error.code), cause: polled.error });
      }
      const key = polled.value;
      if (!key) {
        if (this.now() < this.deadline) return Result.ok({ status: "waiting" });
        this.dispose();
        return Result.err({ code: "expired" });
      }
      // The key is all the check needs: the Session is signed out now, whatever it proves.
      this.dispose();
      if (key !== expectedKey) return Result.err({ code: "wrong_identity" });
      const at = new Date(this.now());
      const recorded = this.repository.recordBackup(expectedKey, "ring-verified", at);
      if (Result.isError(recorded))
        return Result.err({ code: "storage_failed", cause: recorded.error });
      return Result.ok({ status: "verified", at });
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }

  dispose(): void {
    this.generation++;
    const connection = this.connection;
    this.connection = undefined;
    this.expectedKey = undefined;
    this.busy = false;
    // Transport cleanup signs the Session out, contains failures and waits for any SDK call.
    if (connection) void connection.dispose().catch(() => undefined);
  }
}

function verificationFailure(code: PubkyProfileGrantErrorCode): RingVerificationErrorCode {
  switch (code) {
    case "grant_rejected":
    case "homeserver_unresolved":
      return code;
    case "grant_busy":
    case "grant_failed":
    case "missing_capabilities":
      return "connection_failed";
  }
}
