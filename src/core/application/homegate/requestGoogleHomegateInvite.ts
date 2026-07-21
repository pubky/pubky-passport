import type {
  GoogleHomegateInviteErrorCode,
  GoogleHomegateInvitePort,
  HomeserverSignupInvitation,
} from "../../ports/homegateInvite";

export type RequestGoogleHomegateInviteInput = {
  googleIdToken: string;
};

export type RequestGoogleHomegateInviteErrorCode =
  | GoogleHomegateInviteErrorCode
  | "invalid_request"
  | "dependency_unavailable";

export type RequestGoogleHomegateInviteResult =
  | { ok: true; invite: HomeserverSignupInvitation }
  | { ok: false; error: { code: RequestGoogleHomegateInviteErrorCode } };

export type RequestGoogleHomegateInviteUseCase = (
  input: RequestGoogleHomegateInviteInput,
) => Promise<RequestGoogleHomegateInviteResult>;

export type RequestGoogleHomegateInviteDependencies = {
  homegateInvite: GoogleHomegateInvitePort;
};

export function createRequestGoogleHomegateInviteUseCase(
  dependencies: RequestGoogleHomegateInviteDependencies,
): RequestGoogleHomegateInviteUseCase {
  return async function requestGoogleHomegateInvite(input) {
    if (input.googleIdToken.trim().length === 0) {
      return failure("invalid_request");
    }

    let result: Awaited<ReturnType<GoogleHomegateInvitePort["requestInvite"]>>;

    try {
      result = await dependencies.homegateInvite.requestInvite({
        googleIdToken: input.googleIdToken,
      });
    } catch {
      return failure("dependency_unavailable");
    }

    if (!result.ok) {
      return failure(result.error.code);
    }

    return { ok: true, invite: result.value };
  };
}

function failure(code: RequestGoogleHomegateInviteErrorCode): RequestGoogleHomegateInviteResult {
  return { ok: false, error: { code } };
}
