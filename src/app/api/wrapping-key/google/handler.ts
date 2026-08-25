import { NextResponse } from "next/server";
import { Result } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import {
  createGoogleWrappingKeyIssuerFromEnvironment,
  type GoogleWrappingKeyIssuer,
  type GoogleWrappingKeyIssueErrorCode,
} from "../../../../server/wrapping-key/google/GoogleWrappingKeyIssuer";
import type { GoogleWrappingKey } from "../../../../libs/googleWrappingKeyApi";
import {
  GOOGLE_WRAPPING_KEY_RESPONSE_HEADERS,
  parseGoogleIdTokenRequest,
} from "./routePolicy";

type GoogleWrappingKeyRouteBody =
  | GoogleWrappingKey
  | {
    error: {
      code: GoogleWrappingKeyIssueErrorCode | "invalid_request" | "internal_error";
    };
  };

let activeIssuer: GoogleWrappingKeyIssuer | undefined;

export async function googleWrappingKeyPost(
  request: Request,
): Promise<NextResponse<GoogleWrappingKeyRouteBody>> {
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
    if (!activeIssuer) activeIssuer = createGoogleWrappingKeyIssuerFromEnvironment();
    operation = "execute";
    const result = await activeIssuer.issueGoogleWrappingKey(
      body.value.googleIdToken,
      body.value.keyId,
    );

    if (Result.isError(result)) {
      return jsonResponse({ error: { code: result.error.code } }, statusForError(result.error.code));
    }

    return jsonResponse(result.value, 200);
  } catch {
    LOGGER.error("identity.google.wrapping_key.failed", {
      route: "api.wrapping_key.google",
      layer: "route",
      operation,
      code: "internal_error",
    });
    return jsonResponse({ error: { code: "internal_error" } }, 500);
  }
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
    case "key_unavailable":
      return 409;
    case "dependency_unavailable":
      return 503;
  }
}
