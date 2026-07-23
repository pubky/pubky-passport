import "client-only";

import type { Result } from "better-result";

import type { LocalIdentitySummary } from "../../../../features/identity/localIdentity";
import type { PubkyIdentityKeyHandle } from "../../../../features/identity/pubkyIdentity";
import type { LocalIdentityRepositoryErrorCode } from "./localIdentityRepository";

export type LocalIdentityServiceErrorCode =
  | LocalIdentityRepositoryErrorCode
  | "identity_mismatch"
  | "restore_failed";

export type LocalIdentityServiceResult<T> = Result<T, { code: LocalIdentityServiceErrorCode }>;

export type LocalIdentitySaver = {
  saveIdentity(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<LocalIdentityServiceResult<LocalIdentitySummary>>;
};
