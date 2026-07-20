import { NextResponse } from "next/server";

import type { RequestGoogleHomegateInviteController } from "../../../../core/controllers/homegate/requestGoogleHomegateInviteController";
import { readBoundedText } from "../../../../libs/security/boundedBody";

export const runtime = "nodejs";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
const maximumCredentialRequestBytes = 16 * 1024;

type HomegateInviteRequestBody = {
  googleIdToken: string;
};

type HomegateInviteRouteBody =
  | { signupCode: string; homeserverPubky: string }
  | { error: { code: string } };

export const POST = createHomegateInvitePostHandler();

export function createHomegateInvitePostHandler(
  controller?: RequestGoogleHomegateInviteController,
) {
  return async function homegateInvitePost(request: Request): Promise<NextResponse<HomegateInviteRouteBody>> {
    const body = await parseRequestBody(request);

    if (!body.ok) {
      return json({ error: { code: "invalid_request" } }, 400);
    }

    try {
      const activeController = controller ?? await createDefaultController();
      const result = await activeController({ googleIdToken: body.value.googleIdToken });

      return json(result.body, result.status);
    } catch {
      return json({ error: { code: "internal_error" } }, 500);
    }
  };
}

async function createDefaultController(): Promise<RequestGoogleHomegateInviteController> {
  const { createHomegateInviteRequestController } = await import(
    "../../../../infrastructure/composition/homegateServerContainer"
  );

  return createHomegateInviteRequestController();
}

async function parseRequestBody(
  request: Request,
): Promise<{ ok: true; value: HomegateInviteRequestBody } | { ok: false }> {
  const text = await readBoundedText(request, maximumCredentialRequestBytes);
  if (text === null || text === "too_large") {
    return { ok: false };
  }

  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false };
  }

  if (!isRecord(body)) {
    return { ok: false };
  }

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "googleIdToken") {
    return { ok: false };
  }

  if (typeof body.googleIdToken !== "string" || body.googleIdToken.trim().length === 0) {
    return { ok: false };
  }

  return { ok: true, value: { googleIdToken: body.googleIdToken } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: HomegateInviteRouteBody, status: number): NextResponse<HomegateInviteRouteBody> {
  return NextResponse.json(body, { status, headers: responseHeaders });
}
