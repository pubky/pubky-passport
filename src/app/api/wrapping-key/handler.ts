import { NextResponse } from "next/server";
import { Result, type Result as ResultType } from "better-result";

import type { RequestGoogleWrappingKeyController } from "../../../core/identity/requestGoogleWrappingKeyController";
import { createWrappingKeyRequestController } from "../../../composition/server/wrappingKeyServerContainer";
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

    if (Result.isError(body)) {
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
): Promise<ResultType<WrappingKeyRequestBody, "invalid_request">> {
  const text = await readBoundedText(request, maximumCredentialRequestBytes);
  if (text === null || text === "too_large") {
    return Result.err("invalid_request");
  }

  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    return Result.err("invalid_request");
  }

  if (!isRecord(body)) {
    return Result.err("invalid_request");
  }

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "googleIdToken") {
    return Result.err("invalid_request");
  }

  if (typeof body.googleIdToken !== "string" || body.googleIdToken.trim().length === 0) {
    return Result.err("invalid_request");
  }

  return Result.ok({ googleIdToken: body.googleIdToken });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: WrappingKeyRouteBody, status: number): NextResponse<WrappingKeyRouteBody> {
  return NextResponse.json(body, { status, headers: responseHeaders });
}
