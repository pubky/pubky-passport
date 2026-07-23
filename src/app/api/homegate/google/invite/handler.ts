import { Result } from "better-result";
import { NextResponse } from "next/server";

import type {
  GoogleHomegateInvite,
  GoogleHomegateInviteErrorCode,
} from "../../../../../server/homegate/google/invite";
import {
  googleCredentialResponseHeaders,
  parseGoogleIdTokenRequest,
} from "../../../googleCredentialRoutePolicy";

type GoogleHomegateInviteRouteBody =
  | { signupCode: string; homeserverPubky: string }
  | { error: { code: string } };

export function createGoogleHomegateInvitePostHandler(
  invite?: GoogleHomegateInvite,
  createDefaultInviteFactory: () => Promise<GoogleHomegateInvite> = createDefaultInvite,
) {
  let defaultInvite: Promise<GoogleHomegateInvite> | undefined;

  return async function googleHomegateInvitePost(request: Request): Promise<NextResponse<GoogleHomegateInviteRouteBody>> {
    const body = await parseGoogleIdTokenRequest(request);
    if (Result.isError(body)) return json({ error: { code: "invalid_request" } }, 400);

    try {
      const activeInvite = invite ?? await getDefaultInvite();
      const result = await activeInvite.requestSignupInvitation({ googleIdToken: body.value });
      if (Result.isError(result)) {
        return json({ error: { code: result.error.code } }, statusForError(result.error.code));
      }
      return json(result.value, 200);
    } catch {
      return json({ error: { code: "internal_error" } }, 500);
    }
  };

  async function getDefaultInvite(): Promise<GoogleHomegateInvite> {
    const pending = defaultInvite ??= createDefaultInviteFactory();
    try {
      return await pending;
    } catch (error) {
      if (defaultInvite === pending) defaultInvite = undefined;
      throw error;
    }
  }
}

async function createDefaultInvite(): Promise<GoogleHomegateInvite> {
  const { createGoogleHomegateInvite } = await import("../../../../../server/homegate/google/invite");
  return createGoogleHomegateInvite();
}

function statusForError(code: GoogleHomegateInviteErrorCode): number {
  switch (code) {
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
      return 503;
  }
}

function json(body: GoogleHomegateInviteRouteBody, status: number): NextResponse<GoogleHomegateInviteRouteBody> {
  return NextResponse.json(body, { status, headers: googleCredentialResponseHeaders });
}
