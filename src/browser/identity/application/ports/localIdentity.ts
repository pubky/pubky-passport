import "client-only";

import type { Result } from "better-result";

import type { PubkyIdentityKeyHandle } from "../../../pubky/ports";
import type { LocalIdentitySummary } from "../localIdentity";
import type { LocalIdentityRepositoryErrorCode } from "./localIdentityRepository";

export type LocalIdentityServiceErrorCode =
  | LocalIdentityRepositoryErrorCode
  | "identity_mismatch"
  | "restore_failed";

export type LocalIdentityServiceResult<T> = Result<T, { code: LocalIdentityServiceErrorCode }>;

export type LocalIdentitySaver = {
  saveIdentity(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<LocalIdentityServiceResult<LocalIdentitySummary>>;
};
