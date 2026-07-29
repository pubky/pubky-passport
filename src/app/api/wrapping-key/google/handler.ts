import { NextResponse } from "next/server";
import { Result } from "better-result";

import type {
  GoogleWrappingKeyRequestErrorCode,
  RequestGoogleWrappingKey,
} from "../../../../server/wrapping-key/google/application/requestGoogleWrappingKey";
import {
  GOOGLE_WRAPPING_KEY_RESPONSE_HEADERS,
  parseGoogleWrappingKeyRequest,
} from "./routePolicy";

type GoogleWrappingKeyRouteBody =
  | { wrappingKey: string }
  | { error: { code: string } };

export function createGoogleWrappingKeyPostHandler(
  createRequest: () => RequestGoogleWrappingKey,
) {
  let activeRequest: RequestGoogleWrappingKey | undefined;

  return async function googleWrappingKeyPost(request: Request): Promise<NextResponse<GoogleWrappingKeyRouteBody>> {
    const body = await parseGoogleWrappingKeyRequest(request);

    if (Result.isError(body)) {
      return jsonResponse({ error: { code: "invalid_request" } }, 400);
    }

    try {
      const requestGoogleWrappingKey = activeRequest ??= createRequest();
      const result = await requestGoogleWrappingKey(body.value);

      if (Result.isError(result)) {
        return jsonResponse({ error: { code: result.error.code } }, statusForError(result.error.code));
      }

      return jsonResponse({ wrappingKey: result.value }, 200);
    } catch {
      return jsonResponse({ error: { code: "internal_error" } }, 500);
    }
  };
}

function jsonResponse(
  body: GoogleWrappingKeyRouteBody,
  status: number,
): NextResponse<GoogleWrappingKeyRouteBody> {
  return NextResponse.json(body, { status, headers: GOOGLE_WRAPPING_KEY_RESPONSE_HEADERS });
}

function statusForError(code: GoogleWrappingKeyRequestErrorCode): number {
  switch (code) {
    case "invalid_google_id_token":
    case "expired_google_id_token":
    case "unsupported_google_issuer":
    case "unsupported_google_audience":
    case "missing_google_subject":
      return 401;
    case "rate_limited":
      return 429;
    case "dependency_unavailable":
      return 503;
  }
}
