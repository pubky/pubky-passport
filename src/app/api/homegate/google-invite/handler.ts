import { NextResponse } from "next/server";
import { Result } from "better-result";

import type {
  GoogleHomegateInvite,
  GoogleHomegateInviteErrorCode,
} from "../../../../server/homegate/google/invite";
import { parseBoundedJsonStringField } from "../../../../libs/security/parseBoundedJsonStringField";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
const maximumCredentialRequestBytes = 16 * 1024;

type HomegateInviteRouteBody =
  | { signupCode: string; homeserverPubky: string }
  | { error: { code: string } };

export function createHomegateInvitePostHandler(
  invite?: GoogleHomegateInvite,
) {
  return async function homegateInvitePost(request: Request): Promise<NextResponse<HomegateInviteRouteBody>> {
    const body = await parseBoundedJsonStringField(request, "googleIdToken", maximumCredentialRequestBytes);

    if (Result.isError(body)) {
      return json({ error: { code: "invalid_request" } }, 400);
    }

    try {
      const activeInvite = invite ?? await createDefaultInvite();
      const result = await activeInvite.requestInvite({ googleIdToken: body.value });

      if (Result.isError(result)) {
        return json({ error: { code: result.error.code } }, statusForError(result.error.code));
      }

      return json(result.value, 200);
    } catch {
      return json({ error: { code: "internal_error" } }, 500);
    }
  };
}

async function createDefaultInvite(): Promise<GoogleHomegateInvite> {
  const { createProductionGoogleHomegateInvite } = await import(
    "../../../../server/homegate/google/invite"
  );

  return createProductionGoogleHomegateInvite();
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

function json(body: HomegateInviteRouteBody, status: number): NextResponse<HomegateInviteRouteBody> {
  return NextResponse.json(body, { status, headers: responseHeaders });
}
