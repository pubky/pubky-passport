import "server-only";

import { NextResponse } from "next/server";
import { Result } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { WrappingKeyProvider } from "@/server/wrapping-key/deriveWrappingKey";
import type {
  WrappingKeyIssueErrorCode,
  WrappingKeyIssueResult,
} from "@/server/wrapping-key/WrappingKeyIssuer";
import {
  parseIdTokenRequest,
  WRAPPING_KEY_RESPONSE_HEADERS,
  type IdTokenField,
} from "./idTokenRequestPolicy";

type WrappingKeyRouteBody<VerifierErrorCode extends string> =
  | { wrappingKey: string; keyId: string }
  | {
      error: {
        code: WrappingKeyIssueErrorCode<VerifierErrorCode> | "invalid_request" | "internal_error";
      };
    };

type Issuer<VerifierErrorCode extends string> = {
  issueWrappingKey(
    idToken: string,
    keyId?: string,
  ): Promise<WrappingKeyIssueResult<VerifierErrorCode>>;
};

/**
 * Builds the POST handler for `/api/wrapping-key/<provider>`. The issuer is composed on the
 * first valid request and reused; a composition failure is retried on the next request.
 */
export function createWrappingKeyPost<VerifierErrorCode extends string>(options: {
  provider: WrappingKeyProvider;
  tokenField: IdTokenField;
  createIssuer: () => Issuer<VerifierErrorCode>;
  statusForVerifierError: (code: VerifierErrorCode) => number;
}) {
  const route = `api.wrapping_key.${options.provider}`;
  const event = `identity.${options.provider}.wrapping_key.failed`;
  let activeIssuer: Issuer<VerifierErrorCode> | undefined;

  function statusForError(code: WrappingKeyIssueErrorCode<VerifierErrorCode>): number {
    switch (code) {
      case "key_unavailable":
        return 409;
      case "key_derivation_failed":
        return 500;
      default:
        return options.statusForVerifierError(code);
    }
  }

  return async function post(
    request: Request,
  ): Promise<NextResponse<WrappingKeyRouteBody<VerifierErrorCode>>> {
    let operation: "parse" | "compose" | "execute" = "parse";
    try {
      const body = await parseIdTokenRequest(request, options.tokenField);

      if (Result.isError(body)) {
        LOGGER.info(event, {
          route,
          layer: "route",
          operation,
          code: "invalid_request",
          ...(body.error.cause === undefined ? {} : safeErrorLogFields(body.error.cause)),
        });
        return jsonResponse({ error: { code: "invalid_request" } }, 400);
      }

      operation = "compose";
      if (!activeIssuer) activeIssuer = options.createIssuer();
      operation = "execute";
      const result = await activeIssuer.issueWrappingKey(body.value.idToken, body.value.keyId);

      if (Result.isError(result)) {
        return jsonResponse(
          { error: { code: result.error.code } },
          statusForError(result.error.code),
        );
      }

      return jsonResponse(result.value, 200);
    } catch (e) {
      LOGGER.error(event, {
        route,
        layer: "route",
        operation,
        code: "internal_error",
        ...safeErrorLogFields(e),
      });
      return jsonResponse({ error: { code: "internal_error" } }, 500);
    }
  };
}

function jsonResponse<Body>(body: Body, status: number): NextResponse<Body> {
  return NextResponse.json(body, { status, headers: WRAPPING_KEY_RESPONSE_HEADERS });
}
