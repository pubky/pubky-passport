import "server-only";

import { Result } from "better-result";
import { NextResponse } from "next/server";

import type { GoogleAuthorizationCodeExchange } from "../../../../server/google-authorization/googleAuthorizationCodeExchange";
import { parseGoogleAuthorizationCode } from "./routePolicy";

const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

export function createGoogleAuthorizationHandler(createExchange: () => Pick<GoogleAuthorizationCodeExchange, "exchange">) {
  return async function POST(request: Request) {
    const code = await parseGoogleAuthorizationCode(request);
    if (Result.isError(code)) return NextResponse.json({ error: { code: "invalid_request" } }, { status: 400, headers: HEADERS });
    const exchanged = await createExchange().exchange(code.value, new URL(request.url).origin);
    if (Result.isError(exchanged)) {
      return NextResponse.json({ error: exchanged.error }, { status: exchanged.error.code === "dependency_unavailable" ? 503 : 401, headers: HEADERS });
    }
    return NextResponse.json(exchanged.value, { status: 200, headers: HEADERS });
  };
}
