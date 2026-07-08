import type {
  RequestWrappingKeyErrorCode,
  RequestWrappingKeyUseCase,
} from "../../application/identity/requestWrappingKey";

export type RequestWrappingKeyWireErrorCode =
  | "invalid_google_id_token"
  | "expired_google_id_token"
  | "unsupported_google_issuer"
  | "unsupported_google_audience"
  | "missing_google_subject"
  | "rate_limited"
  | "dependency_unavailable";

export type RequestWrappingKeyControllerInput = {
  googleIdToken: string;
};

export type RequestWrappingKeyControllerResult = {
  status: number;
  body:
    | { wrappingKey: string }
    | { error: { code: RequestWrappingKeyWireErrorCode } };
};

export type RequestWrappingKeyController = (
  input: RequestWrappingKeyControllerInput,
) => Promise<RequestWrappingKeyControllerResult>;

export function createRequestWrappingKeyController(
  requestWrappingKey: RequestWrappingKeyUseCase,
): RequestWrappingKeyController {
  return async function requestWrappingKeyController(input) {
    const result = await requestWrappingKey({ provider: "google", idToken: input.googleIdToken });

    if (result.ok) {
      return { status: 200, body: { wrappingKey: result.wrappingKey } };
    }

    const wireCode = toWireErrorCode(result.error.code);

    return {
      status: statusForError(result.error.code),
      body: { error: { code: wireCode } },
    };
  };
}

function toWireErrorCode(code: RequestWrappingKeyErrorCode): RequestWrappingKeyWireErrorCode {
  switch (code) {
    case "invalid_id_token":
      return "invalid_google_id_token";
    case "expired_id_token":
      return "expired_google_id_token";
    case "unsupported_issuer":
      return "unsupported_google_issuer";
    case "unsupported_audience":
      return "unsupported_google_audience";
    case "missing_subject":
      return "missing_google_subject";
    case "rate_limited":
      return "rate_limited";
    case "dependency_unavailable":
      return "dependency_unavailable";
  }
}

function statusForError(code: RequestWrappingKeyErrorCode): number {
  switch (code) {
    case "invalid_id_token":
    case "expired_id_token":
    case "unsupported_issuer":
    case "unsupported_audience":
    case "missing_subject":
      return 401;
    case "rate_limited":
      return 429;
    case "dependency_unavailable":
      return 503;
  }
}
