import "client-only";

import { Result } from "better-result";

import { RestoreActiveLocalIdentityKey } from "../identity/local-identity/application/restoreActiveLocalIdentityKey";
import { LocalStorageIdentityRepository } from "../identity/local-identity/adapters/localStorageIdentityRepository";
import { PubkySdkAdapter } from "../pubky/adapters/pubkySdkAdapter";
import {
  approveActiveAuthorization,
  type ActiveAuthorizationIdentityRestorer,
  type ActiveAuthorizationResult,
} from "./application/approveActiveAuthorization";
import {
  commitAuthorizationEntry,
  readAndScrubAuthorizationEntry,
} from "./adapters/browserAuthorizationEntry";
import type { BrowserAuthorizationController } from "./browserAuthorizationController";
import { PassportAuthorizationController } from "./passportAuthorizationController";

export function createBrowserAuthorizationController(): BrowserAuthorizationController {
  const entry = readAndScrubAuthorizationEntry(window);
  return new PassportAuthorizationController({
    entry,
    dependencies: {
      approveAuthorization: approveWithPubkySdk,
      commitAuthorizationEntry: () => commitAuthorizationEntry(window),
      navigate: (url) => window.location.replace(url),
    },
  });
}

async function approveWithPubkySdk(
  authRequest: Parameters<typeof approveActiveAuthorization>[0]["authRequest"],
): Promise<ActiveAuthorizationResult> {
  let pubky: PubkySdkAdapter;
  try {
    pubky = new PubkySdkAdapter();
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
  pubky: PubkySdkAdapter,
): ActiveAuthorizationIdentityRestorer {
  const localIdentities = new RestoreActiveLocalIdentityKey({
    keyStore: new LocalStorageIdentityRepository(),
    identityKeys: pubky,
  });

  return {
    async restoreActiveIdentity() {
      const restored = await localIdentities.restore();
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
