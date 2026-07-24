import { NextResponse, type NextRequest } from "next/server";

import { createContentSecurityPolicy } from "./src/server/content-security-policy/policy";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = createContentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    homegateBaseUrl: requiredPublicHomegateBaseUrl(),
    ...(request.nextUrl.pathname === "/authorize" && request.nextUrl.search
      ? { authorizationRequestSearch: request.nextUrl.search }
      : {}),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

function requiredPublicHomegateBaseUrl(): string {
  const homegateBaseUrl = process.env.NEXT_PUBLIC_HOMEGATE_URL;
  if (!homegateBaseUrl) throw new Error("NEXT_PUBLIC_HOMEGATE_URL is required");
  return homegateBaseUrl;
}

export const config = {
  matcher: [{
    source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
    missing: [
      { type: "header", key: "next-router-prefetch" },
      { type: "header", key: "purpose", value: "prefetch" },
    ],
  }],
};
