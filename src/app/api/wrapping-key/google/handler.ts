import { NextResponse } from "next/server";
import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import {
  type GoogleWrappingKeyRequest,
  type GoogleWrappingKeyRequestErrorCode,
} from "../../../../server/wrapping-key/google/application/googleWrappingKeyRequest";
import {
  GOOGLE_WRAPPING_KEY_RESPONSE_HEADERS,
  parseGoogleWrappingKeyRequest,
} from "./routePolicy";

type GoogleWrappingKeyRouteBody =
  | { wrappingKey: string }
  | {
    error: {
      code: GoogleWrappingKeyRequestErrorCode | "invalid_request" | "internal_error";
    };
  };

export function createGoogleWrappingKeyPostHandler(
  createRequest: () => Pick<GoogleWrappingKeyRequest, "requestGoogleWrappingKey">,
) {
  let activeRequest: ReturnType<typeof createRequest> | undefined;

  return async function googleWrappingKeyPost(request: Request): Promise<NextResponse<GoogleWrappingKeyRouteBody>> {
    const body = await parseGoogleWrappingKeyRequest(request);

    if (Result.isError(body)) {
      return jsonResponse({ error: { code: "invalid_request" } }, 400);
    }

    let operation: "compose" | "execute" = "compose";
    try {
      if (!activeRequest) activeRequest = createRequest();
      operation = "execute";
      const result = await activeRequest.requestGoogleWrappingKey(body.value);

      if (Result.isError(result)) {
        return jsonResponse({ error: { code: result.error.code } }, statusForError(result.error.code));
      }

      return jsonResponse({ wrappingKey: result.value }, 200);
    } catch {
      LOGGER.error("identity.google.wrapping_key.failed", {
        layer: "route",
        operation,
        code: "internal_error",
      });
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
      return 401;
    case "rate_limited":
      return 429;
    case "dependency_unavailable":
      return 503;
  }
}
