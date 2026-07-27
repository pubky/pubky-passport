import "client-only";

import { Result } from "better-result";

import { parsePubkyAuthRequest } from "../../core/auth/parsePubkyAuthRequest";
import type {
  BrowserManualAuthorizationController,
  ManualAuthorizationEntryResult,
} from "./browserManualAuthorizationController";

export class PassportManualAuthorizationController implements BrowserManualAuthorizationController {
  constructor(private readonly navigate: (url: string) => void) {}

  enter(rawRequest: string): ManualAuthorizationEntryResult {
    const request = rawRequest.trim();
    const parsed = parsePubkyAuthRequest(encodeURIComponent(request));
    if (Result.isError(parsed)) {
      return "invalid";
    }

    this.navigate(`/authorize?d=${encodeURIComponent(request)}`);
    return "navigating";
  }
}
