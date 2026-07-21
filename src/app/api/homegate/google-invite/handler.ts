import { NextResponse } from "next/server";
import { Result } from "better-result";

import type { RequestGoogleHomegateInviteController } from "../../../../server/homegate/requestGoogleHomegateInviteController";
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
  controller?: RequestGoogleHomegateInviteController,
) {
  return async function homegateInvitePost(request: Request): Promise<NextResponse<HomegateInviteRouteBody>> {
    const body = await parseBoundedJsonStringField(request, "googleIdToken", maximumCredentialRequestBytes);

    if (Result.isError(body)) {
      return json({ error: { code: "invalid_request" } }, 400);
    }

    try {
      const activeController = controller ?? await createDefaultController();
      const result = await activeController({ googleIdToken: body.value });

      return json(result.body, result.status);
    } catch {
      return json({ error: { code: "internal_error" } }, 500);
    }
  };
}

async function createDefaultController(): Promise<RequestGoogleHomegateInviteController> {
  const { createHomegateInviteRequestController } = await import(
    "../../../../server/homegate/googleInvite"
  );

  return createHomegateInviteRequestController();
}

function json(body: HomegateInviteRouteBody, status: number): NextResponse<HomegateInviteRouteBody> {
  return NextResponse.json(body, { status, headers: responseHeaders });
}
