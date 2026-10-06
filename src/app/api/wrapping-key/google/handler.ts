import { NextResponse } from "next/server";
import { Result } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import {
  GoogleWrappingKeyIssuer,
  type GoogleWrappingKeyIssueErrorCode,
} from "@/server/wrapping-key/google/GoogleWrappingKeyIssuer";
import { GOOGLE_WRAPPING_KEY_RESPONSE_HEADERS, parseGoogleIdTokenRequest } from "./routePolicy";

type GoogleWrappingKeyRouteBody =
  | { wrappingKey: string; keyId: string }
  | {
      error: {
        code:
          | GoogleWrappingKeyIssueErrorCode
          | "google_unavailable"
          | "invalid_request"
          | "reload_required"
          | "internal_error";
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
        code: body.error.code,
        ...(body.error.cause === undefined ? {} : safeErrorLogFields(body.error.cause)),
      });
      return jsonResponse({ error: { code: body.error.code } }, 400);
    }

    operation = "compose";
    if (!activeIssuer) {
      const composed = GoogleWrappingKeyIssuer.fromEnvironment();
      if (Result.isError(composed)) {
        // A Google-free instance is a deliberate operator choice, not a server failure.
        LOGGER.info("identity.google.wrapping_key.failed", {
          route: "api.wrapping_key.google",
          layer: "route",
          operation,
          code: composed.error.code,
        });
        return jsonResponse({ error: { code: composed.error.code } }, 404);
      }
      activeIssuer = composed.value;
    }
    operation = "execute";
    const result = await activeIssuer.issueGoogleWrappingKey(
      body.value.googleIdToken,
      body.value.googleNoncePreimage,
      body.value.keyId,
    );

    if (Result.isError(result)) {
      return jsonResponse(
        { error: { code: result.error.code } },
        statusForError(result.error.code),
      );
    }

    return jsonResponse(result.value, 200);
  } catch (e) {
    LOGGER.error("identity.google.wrapping_key.failed", {
      route: "api.wrapping_key.google",
      layer: "route",
      operation,
      code: "internal_error",
      ...safeErrorLogFields(e),
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
    case "google_verifier_unavailable":
      return 503;
    case "key_derivation_failed":
      return 500;
  }
}
