import type { Result } from "better-result";

import type { PassportFileEnvelopeV1 } from "../domain/passport-file/passportFile";

export type PassportFileReadResult = { status: "found"; envelope: PassportFileEnvelopeV1 } | { status: "missing" };

export type PassportFileRepositoryErrorCode =
  | "unauthorized"
  | "forbidden"
  | "network_failed"
  | "invalid_response"
  | "invalid_file"
  | "duplicate_files"
  | "write_failed";

export type PassportFileRepositoryError = {
  code: PassportFileRepositoryErrorCode;
};

export type PassportFileRepositoryResult<T> = Result<T, PassportFileRepositoryError>;

/**
 * Port for reading and writing Passport's encrypted identity file.
 *
 * The core layer depends on this storage behavior without knowing whether the
 * file lives in Google Drive, another browser-backed store, or a test fake.
 */
export interface PassportFileRepository {
  readPassportFile(): Promise<PassportFileRepositoryResult<PassportFileReadResult>>;
  writePassportFile(input: { envelope: PassportFileEnvelopeV1 }): Promise<PassportFileRepositoryResult<void>>;
}
