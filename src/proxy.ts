import { NextResponse, type NextRequest } from "next/server";

import { LOGGER } from "./libs/logger/logger";
import { getBrowserBootstrapConfig } from "./server/config/browserBootstrapConfig";
import { createContentSecurityPolicy } from "./server/content-security-policy/policy";

export function proxy(request: NextRequest) {
  try {
    const config = getBrowserBootstrapConfig();
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const contentSecurityPolicy = createContentSecurityPolicy({
      nonce,
      development: process.env.NODE_ENV === "development",
      homegateOrigin: config.homegateOrigin,
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
  } catch (error) {
    LOGGER.error("proxy.bootstrap.failed", {
      layer: "proxy",
      operation: "build_response_policy",
      code: "runtime_exception",
    });
    throw error;
  }
}

export const CONFIG = {
  matcher: [{
    source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
    missing: [
      { type: "header", key: "next-router-prefetch" },
      { type: "header", key: "purpose", value: "prefetch" },
    ],
  }],
};
