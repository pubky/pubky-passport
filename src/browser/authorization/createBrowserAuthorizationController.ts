import "client-only";

import { Result } from "better-result";

import { LocalIdentityService } from "../identity/localIdentityService";
import { LocalStorageIdentityRepository } from "../identity/localIdentityRepository";
import { BrowserPubky } from "../pubky/browserPubky";
import { approveActiveAuthorization, type ActiveAuthorizationResult } from "./approveActiveAuthorization";
import type { BrowserAuthorizationController } from "./browserAuthorizationController";
import { createBrowserAuthorizationControllerCore } from "./browserAuthorizationControllerInternals";

export function createBrowserAuthorizationController(input: {
  relayOrigin: string;
}): BrowserAuthorizationController {
  return createBrowserAuthorizationControllerCore({
    browserWindow: window,
    relayOrigin: input.relayOrigin,
    dependencies: {
      approveAuthorization: approveWithBrowserPubky,
      navigate: (url) => window.location.replace(url),
    },
  });
}

async function approveWithBrowserPubky(
  authRequest: Parameters<typeof approveActiveAuthorization>[0]["authRequest"],
): Promise<ActiveAuthorizationResult> {
  let pubky: BrowserPubky;
  try {
    pubky = new BrowserPubky();
  } catch {
    return Result.err({ code: "approval_failed" });
  }

  try {
    return await approveActiveAuthorization({
      authRequest,
      localIdentities: new LocalIdentityService({
        repository: new LocalStorageIdentityRepository(),
        identityKeys: pubky,
      }),
      pubky,
    });
  } finally {
    try {
      pubky.dispose();
    } catch {
      // Per-key cleanup was already attempted by the authorization use case.
    }
  }
}
