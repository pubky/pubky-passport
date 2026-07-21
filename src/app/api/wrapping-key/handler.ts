import { NextResponse } from "next/server";
import { Result } from "better-result";

import type { RequestGoogleWrappingKeyController } from "../../../server/identity/requestGoogleWrappingKeyController";
import { parseBoundedJsonStringField } from "../../../libs/security/parseBoundedJsonStringField";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
const maximumCredentialRequestBytes = 16 * 1024;

type WrappingKeyRouteBody =
  | { wrappingKey: string }
  | { error: { code: string } };

export function createWrappingKeyPostHandler(
  controller?: RequestGoogleWrappingKeyController,
) {
  return async function wrappingKeyPost(request: Request): Promise<NextResponse<WrappingKeyRouteBody>> {
    const body = await parseRequestBody(request);

    if (Result.isError(body)) {
      return json({ error: { code: "invalid_request" } }, 400);
    }

    try {
      const activeController = controller ?? await createDefaultController();
      const result = await activeController({ googleIdToken: body.value });

      return json(result.body, result.status);
    } catch {
      return json({ error: { code: "internal_error" } }, 500);
    }
  };
}

async function createDefaultController(): Promise<RequestGoogleWrappingKeyController> {
  const { createWrappingKeyRequestController } = await import("../../../server/identity/wrappingKey");

  return createWrappingKeyRequestController();
}

async function parseRequestBody(
  request: Request,
): ReturnType<typeof parseBoundedJsonStringField> {
  return parseBoundedJsonStringField(request, "googleIdToken", maximumCredentialRequestBytes);
}

function json(body: WrappingKeyRouteBody, status: number): NextResponse<WrappingKeyRouteBody> {
  return NextResponse.json(body, { status, headers: responseHeaders });
}
