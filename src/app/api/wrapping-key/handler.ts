import { NextResponse } from "next/server";

import type { RequestGoogleWrappingKeyController } from "../../../core/controllers/identity/requestGoogleWrappingKeyController";
import { createWrappingKeyRequestController } from "../../../infrastructure/composition/wrappingKeyServerContainer";
import { readBoundedText } from "../../../libs/security/boundedBody";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
const maximumCredentialRequestBytes = 16 * 1024;

type WrappingKeyRequestBody = {
  googleIdToken: string;
};

type WrappingKeyRouteBody =
  | { wrappingKey: string }
  | { error: { code: string } };

export function createWrappingKeyPostHandler(
  controller: RequestGoogleWrappingKeyController = createWrappingKeyRequestController(),
) {
  return async function wrappingKeyPost(request: Request): Promise<NextResponse<WrappingKeyRouteBody>> {
    const body = await parseRequestBody(request);

    if (!body.ok) {
      return json({ error: { code: "invalid_request" } }, 400);
    }

    try {
      const result = await controller({ googleIdToken: body.value.googleIdToken });

      return json(result.body, result.status);
    } catch {
      return json({ error: { code: "internal_error" } }, 500);
    }
  };
}

async function parseRequestBody(
  request: Request,
): Promise<{ ok: true; value: WrappingKeyRequestBody } | { ok: false }> {
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

function json(body: WrappingKeyRouteBody, status: number): NextResponse<WrappingKeyRouteBody> {
  return NextResponse.json(body, { status, headers: responseHeaders });
}
