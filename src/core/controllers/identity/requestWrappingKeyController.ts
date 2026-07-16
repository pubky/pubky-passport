import { Result } from "better-result";

import type {
  RequestWrappingKeyErrorCode,
  RequestWrappingKeyUseCase,
} from "../../application/identity/requestWrappingKey";

export type RequestWrappingKeyControllerInput = {
  googleIdToken: string;
};

export type RequestWrappingKeyControllerResult = {
  status: number;
  body:
    | { wrappingKey: string }
    | { error: { code: RequestWrappingKeyErrorCode } };
};

export type RequestWrappingKeyController = (
  input: RequestWrappingKeyControllerInput,
) => Promise<RequestWrappingKeyControllerResult>;

export function createRequestWrappingKeyController(
  requestWrappingKey: RequestWrappingKeyUseCase,
): RequestWrappingKeyController {
  return async function requestWrappingKeyController(input) {
    const result = await requestWrappingKey(input);

    if (Result.isOk(result)) {
      return { status: 200, body: { wrappingKey: result.value } };
    }

    return {
      status: statusForError(result.error.code),
      body: { error: { code: result.error.code } },
    };
  };
}

function statusForError(code: RequestWrappingKeyErrorCode): number {
  switch (code) {
    case "invalid_google_id_token":
    case "expired_google_id_token":
    case "unsupported_google_issuer":
    case "unsupported_google_audience":
    case "missing_google_subject":
      return 401;
    case "rate_limited":
      return 429;
    case "dependency_unavailable":
      return 503;
  }
}
