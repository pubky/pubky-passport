import { NextResponse } from "next/server";
import { Result } from "better-result";

import type {
  GoogleWrappingKeyRequest,
  GoogleWrappingKeyRequestErrorCode,
} from "../../../../server/wrapping-key/google/request";
import {
  googleCredentialResponseHeaders,
  parseGoogleIdTokenRequest,
} from "../../googleCredentialRoutePolicy";

type GoogleWrappingKeyRouteBody =
  | { wrappingKey: string }
  | { error: { code: string } };

export function createGoogleWrappingKeyPostHandler(
  wrappingKeyRequest?: GoogleWrappingKeyRequest,
  createDefaultRequestFactory: () => Promise<GoogleWrappingKeyRequest> = createDefaultRequest,
) {
  let defaultRequest: Promise<GoogleWrappingKeyRequest> | undefined;

  return async function googleWrappingKeyPost(request: Request): Promise<NextResponse<GoogleWrappingKeyRouteBody>> {
    const body = await parseGoogleIdTokenRequest(request);

    if (Result.isError(body)) {
      return json({ error: { code: "invalid_request" } }, 400);
    }

    try {
      const activeRequest = wrappingKeyRequest ?? await getDefaultRequest();
      const result = await activeRequest.requestWrappingKey({ googleIdToken: body.value });

      if (Result.isError(result)) {
        return json({ error: { code: result.error.code } }, statusForError(result.error.code));
      }

      return json({ wrappingKey: result.value }, 200);
    } catch {
      return json({ error: { code: "internal_error" } }, 500);
    }
  };

  async function getDefaultRequest(): Promise<GoogleWrappingKeyRequest> {
    const pending = defaultRequest ??= createDefaultRequestFactory();
    try {
      return await pending;
    } catch (error) {
      if (defaultRequest === pending) defaultRequest = undefined;
      throw error;
    }
  }
}

async function createDefaultRequest(): Promise<GoogleWrappingKeyRequest> {
  const { createConfiguredGoogleWrappingKeyRequest } = await import(
    "../../../../server/wrapping-key/google/composition"
  );

  return createConfiguredGoogleWrappingKeyRequest();
}

function json(body: GoogleWrappingKeyRouteBody, status: number): NextResponse<GoogleWrappingKeyRouteBody> {
  return NextResponse.json(body, { status, headers: googleCredentialResponseHeaders });
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
