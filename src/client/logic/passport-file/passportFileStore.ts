import type { Result } from "better-result";

import type { PassportFileEnvelope } from "./passportFileEnvelope";

/** Result of looking up the one operational Passport file in a provider's storage. */
export type PassportFileReadResult<Reference> =
  { status: "found"; envelope: PassportFileEnvelope; reference: Reference } | { status: "missing" };

/**
 * Storage for the one encrypted Passport file in a provider account. Every store only ever
 * sees the envelope; key material never reaches it. `Reference` pins the exact version that
 * was read, so a delete never removes a file another device changed meanwhile.
 * Failures use `invalid_file` for a file that exists but is not a valid envelope and
 * `create_conflict` when a file appeared while creating one.
 */
export type PassportFileStore<Reference, Failure extends { code: string }> = {
  readPassportFile(): Promise<Result<PassportFileReadResult<Reference>, Failure>>;
  createPassportFile(envelope: PassportFileEnvelope): Promise<Result<void, Failure>>;
  deletePassportFile(reference: Reference): Promise<Result<void, Failure>>;
  deleteInvalidPassportFile(): Promise<Result<"deleted" | "missing", Failure>>;
};
