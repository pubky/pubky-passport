import type {
  RequestGoogleHomegateInviteErrorCode,
  RequestGoogleHomegateInviteUseCase,
} from "../../application/homegate/requestGoogleHomegateInvite";

export type RequestGoogleHomegateInviteControllerInput = {
  googleIdToken: string;
};

export type RequestGoogleHomegateInviteControllerResult = {
  status: number;
  body:
    | { signupCode: string; homeserverPubky: string }
    | { error: { code: RequestGoogleHomegateInviteErrorCode } };
};

export type RequestGoogleHomegateInviteController = (
  input: RequestGoogleHomegateInviteControllerInput,
) => Promise<RequestGoogleHomegateInviteControllerResult>;

export function createRequestGoogleHomegateInviteController(
  requestGoogleHomegateInvite: RequestGoogleHomegateInviteUseCase,
): RequestGoogleHomegateInviteController {
  return async function requestGoogleHomegateInviteController(input) {
    const result = await requestGoogleHomegateInvite(input);

    if (Result.isOk(result)) {
      return {
        status: 200,
        body: {
          signupCode: result.value.signupCode,
          homeserverPubky: result.value.homeserverPubky,
        },
      };
    }

    return {
      status: statusForError(result.error.code),
      body: { error: { code: result.error.code } },
    };
  };
}

function statusForError(code: RequestGoogleHomegateInviteErrorCode): number {
  switch (code) {
    case "invalid_request":
      return 400;
    case "invalid_google_id_token":
      return 401;
    case "weekly_limit_exceeded":
    case "annual_limit_exceeded":
      return 429;
    case "homegate_invalid_request":
    case "malformed_homegate_response":
      return 502;
    case "homeserver_unavailable":
    case "google_verifier_unavailable":
    case "homegate_unavailable":
    case "dependency_unavailable":
      return 503;
  }
}
import { Result } from "better-result";
