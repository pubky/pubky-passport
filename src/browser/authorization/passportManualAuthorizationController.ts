import "client-only";

import { Result } from "better-result";

import { parsePubkyAuthRequest } from "../../core/auth/parsePubkyAuthRequest";
import { pubkyAuthRequestLimits } from "../../core/auth/pubkyAuthRequestLimits";
import type {
  BrowserManualAuthorizationController,
  ManualAuthorizationEntryResult,
} from "./browserManualAuthorizationController";

export class PassportManualAuthorizationController implements BrowserManualAuthorizationController {
  constructor(private readonly navigate: (url: string) => void) {}

  enter(rawRequest: string): ManualAuthorizationEntryResult {
    if (rawRequest.length > pubkyAuthRequestLimits.decodedAuthUrlLength) {
      return "invalid";
    }

    const request = rawRequest.trim();
    let encodedRequest: string;
    try {
      encodedRequest = encodeURIComponent(request);
    } catch {
      return "invalid";
    }

    const parsed = parsePubkyAuthRequest(encodedRequest);
    if (Result.isError(parsed)) {
      return "invalid";
    }

    this.navigate(`/authorize?d=${encodedRequest}`);
    return "navigating";
  }
}
