import type {
  GoogleHomegateInvite,
  HomegateInviteErrorCode,
  HomegateInvitePort,
} from "../../ports/homegateInvite";

export type RequestGoogleHomegateInviteInput = {
  googleIdToken: string;
};

export type RequestGoogleHomegateInviteErrorCode =
  | HomegateInviteErrorCode
  | "invalid_request"
  | "dependency_unavailable";

export type RequestGoogleHomegateInviteResult =
  | { ok: true; invite: GoogleHomegateInvite }
  | { ok: false; error: { code: RequestGoogleHomegateInviteErrorCode } };

export type RequestGoogleHomegateInviteUseCase = (
  input: RequestGoogleHomegateInviteInput,
) => Promise<RequestGoogleHomegateInviteResult>;

export type RequestGoogleHomegateInviteDependencies = {
  homegateInvite: HomegateInvitePort;
};

export function createRequestGoogleHomegateInviteUseCase(
  dependencies: RequestGoogleHomegateInviteDependencies,
): RequestGoogleHomegateInviteUseCase {
  return async function requestGoogleHomegateInvite(input) {
    if (input.googleIdToken.trim().length === 0) {
      return failure("invalid_request");
    }

    let result: Awaited<ReturnType<HomegateInvitePort["requestGoogleInvite"]>>;

    try {
      result = await dependencies.homegateInvite.requestGoogleInvite({
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
