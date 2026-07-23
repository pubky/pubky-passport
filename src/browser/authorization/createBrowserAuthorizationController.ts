import "client-only";

import { Result } from "better-result";

import { LocalStorageIdentityRepository } from "../identity/adapters/localStorageIdentityRepository";
import { LocalIdentityService } from "../identity/application/localIdentityService";
import { BrowserPubky } from "../pubky/browserPubky";
import {
  approveActiveAuthorization,
  type ActiveAuthorizationIdentityRestorer,
  type ActiveAuthorizationResult,
} from "./approveActiveAuthorization";
import type { BrowserAuthorizationController } from "./browserAuthorizationController";
import { createDefaultBrowserAuthorizationController } from "./defaultBrowserAuthorizationController";

export function createBrowserAuthorizationController(): BrowserAuthorizationController {
  return createDefaultBrowserAuthorizationController({
    browserWindow: window,
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
    const localIdentities = createActiveAuthorizationIdentityRestorer(pubky);
    return await approveActiveAuthorization({
      authRequest,
      localIdentities,
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

function createActiveAuthorizationIdentityRestorer(
  pubky: BrowserPubky,
): ActiveAuthorizationIdentityRestorer {
  const localIdentities = new LocalIdentityService({
    repository: new LocalStorageIdentityRepository(),
    identityKeys: pubky,
  });

  return {
    async restoreActiveIdentity() {
      const restored = await localIdentities.restoreActiveIdentity();
      if (Result.isError(restored)) {
        return Result.err({
          code: restored.error.code === "no_active_identity"
            ? "no_active_identity"
            : "identity_restore_failed",
        });
      }
      return Result.ok(restored.value);
    },
  };
}
