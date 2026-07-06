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

export type PassportFileRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PassportFileRepositoryError };

export interface PassportFileRepository {
  readPassportFile(): Promise<PassportFileRepositoryResult<PassportFileReadResult>>;
  writePassportFile(input: { envelope: PassportFileEnvelopeV1 }): Promise<PassportFileRepositoryResult<void>>;
}
