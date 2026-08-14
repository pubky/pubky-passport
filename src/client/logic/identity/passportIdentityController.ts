import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import { GoogleImplicitAuthorization } from "../google-authorization/googleImplicitAuthorization";
import { resolvePubkyHomeserver, type PubkyHomeserverResolutionResult } from "../pubky/pubkySdkAdapter";
import {
  GoogleBackedIdentityFlow,
  type GoogleIdentityFlow,
  type GoogleIdentityFlowState,
} from "./google-backed/googleBackedIdentityFlow";
import {
  CreateLocalIdentityBackup,
  type LocalIdentityBackupResult,
} from "./local/createLocalIdentityBackup";
import type {
  LocalIdentityCatalog,
  LocalIdentityResult,
} from "./local/localStorageIdentityRepository";
import { LocalStorageIdentityRepository } from "./local/localStorageIdentityRepository";

export type { LocalIdentityCatalog, LocalIdentityMetadata } from "./local/localStorageIdentityRepository";
export type { GoogleAccountProfile } from "./google-backed/googleBackedIdentityCredentials";
export type { PubkyPublicIdentity } from "./pubkyPublicIdentity";
export type { GoogleBackedIdentityProgress } from "./google-backed/establishGoogleBackedIdentity";
export type {
  GoogleIdentityFlow,
  GoogleIdentityFlowError,
  GoogleIdentityFlowState,
} from "./google-backed/googleBackedIdentityFlow";
export type { PubkyHomeserverResolutionResult } from "../pubky/pubkySdkAdapter";
export type { LocalIdentityBackupFile, LocalIdentityBackupResult } from "./local/createLocalIdentityBackup";
export { MIN_BACKUP_PASSWORD_LENGTH } from "./local/createLocalIdentityBackup";

/**
 * Browser entry point for local Pubky identity management.
 *
 * This controller owns the local identity repository and exposes user-facing use
 * cases by name. A Google setup or detachment screen starts its own
 * {@link GoogleIdentityFlow}; that flow owns Google credentials, progress,
 * cancellation, and cleanup for the lifetime of that screen.
 */
export class PassportIdentityController {
  private repository: LocalStorageIdentityRepository;
  private createLocalIdentityBackup: CreateLocalIdentityBackup;
  private googleClientId: string;
  private homegateBaseUrl: string;

  constructor(googleClientId: string, homegateBaseUrl: string) {
    try {
      this.repository = new LocalStorageIdentityRepository();
      this.createLocalIdentityBackup = new CreateLocalIdentityBackup(
        (identityId) => this.repository.read(identityId),
      );
      this.googleClientId = googleClientId;
      this.homegateBaseUrl = homegateBaseUrl;
    } catch (error) {
      LOGGER.error("identity.controller.failed", {
        operation: "initialize",
        code: "runtime_exception",
      });
      throw error;
    }
  }

  /** Returns public identity metadata without exposing stored secret key bytes. */
  listIdentities(): LocalIdentityResult<LocalIdentityCatalog> {
    return this.repository.list();
  }

  /** Makes an existing local identity active for Passport authorization. */
  selectIdentity(identityId: string): LocalIdentityResult<void> {
    return this.repository.select(identityId);
  }

  /**
   * Removes one identity from this browser only.
   *
   * This does not delete Google Drive backups. Google detachment must use
   * {@link GoogleIdentityFlow.detachIdentity} instead.
   */
  removeIdentity(identityId: string): LocalIdentityResult<void> {
    return this.repository.remove(identityId);
  }

  /** Resolves the homeserver currently published for a Pubky identity. */
  readonly resolveHomeserver = (
    publicKeyZ32: string,
  ): Promise<PubkyHomeserverResolutionResult> => resolvePubkyHomeserver(publicKeyZ32);

  /** Creates a password-encrypted recovery file for one local identity. */
  readonly createEncryptedBackup = (
    identityId: string,
    password: string,
  ): Promise<LocalIdentityBackupResult> => this.createLocalIdentityBackup.create(identityId, password);

  /** Creates a Pubky Ring migration URL for the currently active identity. */
  createPubkyRingMigrationUrl(): LocalIdentityResult<string> {
    const stored = this.repository.readActive();
    if (Result.isError(stored)) return Result.err(stored.error);

    try {
      const secretKey = Array.from(
        stored.value.secretKey.bytes,
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      return Result.ok(`pubkyring://migrate?index=0&total=1&key=${secretKey}`);
    } finally {
      stored.value.secretKey.bytes.fill(0);
    }
  }

  /**
   * Starts an isolated Google identity flow for one mounted UI screen.
   *
   * The caller must dispose the returned flow when the screen unmounts. Tokens
   * remain inside that flow and are never returned through its state callback.
   */
  startGoogleIdentityFlow(
    onState: (state: GoogleIdentityFlowState) => void,
  ): GoogleIdentityFlow {
    try {
      const flow = new GoogleBackedIdentityFlow(
        this.repository,
        new GoogleImplicitAuthorization({ clientId: this.googleClientId }),
        this.homegateBaseUrl,
        globalThis.location.origin,
        onState,
      );
      flow.start();
      return flow;
    } catch (error) {
      LOGGER.error("identity.controller.failed", {
        operation: "start_google_flow",
        code: "runtime_exception",
      });
      throw error;
    }
  }
}
