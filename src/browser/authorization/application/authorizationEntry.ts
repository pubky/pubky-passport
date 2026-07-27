import "client-only";

import type {
  PubkyAuthRequestReview,
  ValidatedSensitivePubkyAuthRequest,
} from "../../../core/auth/parsePubkyAuthRequest";

export type ParsedAuthorizationEntry =
  | { status: "valid"; review: PubkyAuthRequestReview; approval: ValidatedSensitivePubkyAuthRequest }
  | { status: "invalid" };
