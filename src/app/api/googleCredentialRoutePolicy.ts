import { parseBoundedJsonStringField } from "../../libs/security/parseBoundedJsonStringField";

const maximumCredentialRequestBytes = 16 * 1024;

export const googleCredentialResponseHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

export function parseGoogleIdTokenRequest(request: Request) {
  return parseBoundedJsonStringField(request, "googleIdToken", maximumCredentialRequestBytes);
}
