import { Result, type Result as ResultType } from "better-result";

import type {
  GoogleHomegateInviteClient,
  GoogleHomegateInviteErrorCode,
  HomeserverSignupInvitation,
} from "./dependencies";

export type RequestGoogleHomegateInviteInput = {
  googleIdToken: string;
};

export type RequestGoogleHomegateInviteErrorCode =
  | GoogleHomegateInviteErrorCode
  | "invalid_request"
  | "dependency_unavailable";

export type RequestGoogleHomegateInviteResult =
  ResultType<HomeserverSignupInvitation, { code: RequestGoogleHomegateInviteErrorCode }>;

export type RequestGoogleHomegateInviteUseCase = (
  input: RequestGoogleHomegateInviteInput,
) => Promise<RequestGoogleHomegateInviteResult>;

export type RequestGoogleHomegateInviteDependencies = {
  homegateInvite: GoogleHomegateInviteClient;
};

export function createRequestGoogleHomegateInviteUseCase(
  dependencies: RequestGoogleHomegateInviteDependencies,
): RequestGoogleHomegateInviteUseCase {
  return async function requestGoogleHomegateInvite(input) {
    if (input.googleIdToken.trim().length === 0) {
      return failure("invalid_request");
    }

    let result: Awaited<ReturnType<GoogleHomegateInviteClient["requestInvite"]>>;

    try {
      result = await dependencies.homegateInvite.requestInvite({
        googleIdToken: input.googleIdToken,
      });
    } catch {
      return failure("dependency_unavailable");
    }

    if (Result.isError(result)) {
      return failure(result.error.code);
    }

    return Result.ok(result.value);
  };
}

function failure(code: RequestGoogleHomegateInviteErrorCode): RequestGoogleHomegateInviteResult {
  return Result.err({ code });
}
