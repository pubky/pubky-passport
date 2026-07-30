import "client-only";

import type { Result } from "better-result";

import type { PassportFileEnvelopeV1 } from "../../core/passport-file/passportFile";

export type PassportFileReference = Readonly<{
  storageId: string;
  revision: string;
}>;

export type PassportFileReadResult =
  | { status: "found"; envelope: PassportFileEnvelopeV1; reference: PassportFileReference }
  | { status: "missing" };

export type PassportFileStoreErrorCode =
  | "unauthorized"
  | "forbidden"
  | "network_failed"
  | "invalid_response"
  | "invalid_file"
  | "duplicate_files"
  | "create_conflict"
  | "stale_file"
  | "write_failed"
  | "delete_failed";

export type PassportFileStoreResult<T> = Result<T, { code: PassportFileStoreErrorCode }>;
