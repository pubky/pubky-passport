import { NextResponse } from "next/server";
import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import {
  GoogleWrappingKeyIssuer,
  type GoogleWrappingKeyIssueErrorCode,
} from "../../../../server/wrapping-key/google/GoogleWrappingKeyIssuer";
import {
  GOOGLE_WRAPPING_KEY_RESPONSE_HEADERS,
  parseGoogleIdTokenRequest,
} from "./routePolicy";

type GoogleWrappingKeyRouteBody =
  | { wrappingKey: string }
  | {
    error: {
      code: GoogleWrappingKeyIssueErrorCode | "invalid_request" | "internal_error";
    };
  };

export function createGoogleWrappingKeyPostHandler() {
  let activeIssuer: GoogleWrappingKeyIssuer | undefined;

  return async function googleWrappingKeyPost(request: Request): Promise<NextResponse<GoogleWrappingKeyRouteBody>> {
    let operation: "parse" | "compose" | "execute" = "parse";
    try {
      const body = await parseGoogleIdTokenRequest(request);

      if (Result.isError(body)) {
        LOGGER.info("identity.google.wrapping_key.failed", {
          route: "api.wrapping_key.google",
          layer: "route",
          operation,
          code: "invalid_request",
        });
        return jsonResponse({ error: { code: "invalid_request" } }, 400);
      }

      operation = "compose";
      if (!activeIssuer) activeIssuer = GoogleWrappingKeyIssuer.fromEnvironment();
      operation = "execute";
      const result = await activeIssuer.issueGoogleWrappingKey(body.value);

      if (Result.isError(result)) {
        return jsonResponse({ error: { code: result.error.code } }, statusForError(result.error.code));
      }

      return jsonResponse({ wrappingKey: result.value }, 200);
    } catch {
      LOGGER.error("identity.google.wrapping_key.failed", {
        route: "api.wrapping_key.google",
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

function statusForError(code: GoogleWrappingKeyIssueErrorCode): number {
  switch (code) {
    case "invalid_google_id_token":
      return 401;
    case "rate_limited":
      return 429;
    case "dependency_unavailable":
      return 503;
  }
}
