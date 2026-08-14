import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import type { PubkyPublicIdentity } from "../pubkyPublicIdentity";
import type { LocalStorageIdentityRepository } from "../local/localStorageIdentityRepository";
import type { DeleteGoogleIdentityBackups } from "./deleteGoogleIdentityBackups";
import type { GoogleBackedIdentityCredentials } from "./googleBackedIdentityCredentials";

export type DetachGoogleBackedIdentityErrorCode =
  | "backup_deletion_failed"
  | "local_remove_failed"
  | "unexpected_failure";

export type DetachGoogleBackedIdentityResult = ResultType<
  { deletionStatus: "deleted" | "missing" },
  { code: DetachGoogleBackedIdentityErrorCode }
>;

export class DetachGoogleBackedIdentity {
  constructor(
    private deleteBackups: DeleteGoogleIdentityBackups["deleteGoogleIdentityBackups"],
    private removeLocalIdentity: LocalStorageIdentityRepository["remove"]
  ) {}

  async execute(
    credentials: GoogleBackedIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleAccountId: string,
  ): Promise<DetachGoogleBackedIdentityResult> {
    try {
      const deleted = await this.deleteBackups(
        credentials,
        publicIdentity,
        expectedGoogleAccountId,
      );
      if (Result.isError(deleted)) return Result.err({ code: "backup_deletion_failed" });

      const removed = this.removeLocalIdentity(publicIdentity.publicKeyZ32);
      return Result.isError(removed)
        ? Result.err({ code: "local_remove_failed" })
        : Result.ok({ deletionStatus: deleted.value.status });
    } catch {
      LOGGER.warn("identity.google.detach.failed", { code: "unexpected_failure" });
      return Result.err({ code: "unexpected_failure" });
    }
  }
}
