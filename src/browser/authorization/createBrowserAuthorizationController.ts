import "client-only";

import { Result } from "better-result";

import { LOGGER } from "../../libs/logger/logger";
import { RestoreActiveLocalIdentityKey } from "../identity/local-identity/application/restoreActiveLocalIdentityKey";
import { LocalStorageIdentityRepository } from "../identity/local-identity/adapters/localStorageIdentityRepository";
import { PubkySdkAdapter } from "../pubky/adapters/pubkySdkAdapter";
import {
  approveActiveAuthorization,
  type ActiveAuthorizationIdentityRestoreResult,
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
    LOGGER.warn("authorize.approval.failed", {
      stage: "sdk_initialize",
      code: "unexpected_failure",
    });
    return Result.err({ code: "approval_failed" });
  }

  try {
    const restoreActiveIdentity = createRestoreActiveAuthorizationIdentity(pubky);
    return await approveActiveAuthorization({
      authRequest,
      restoreActiveIdentity,
      pubky,
    });
  } finally {
    try {
      pubky.dispose();
    } catch {
      LOGGER.warn("authorize.cleanup.failed", { operation: "pubky_dispose" });
    }
  }
}

function createRestoreActiveAuthorizationIdentity(
  pubky: PubkySdkAdapter,
): () => Promise<ActiveAuthorizationIdentityRestoreResult> {
  const repository = new LocalStorageIdentityRepository();
  const localIdentities = new RestoreActiveLocalIdentityKey({
    readActive: repository.readActive.bind(repository),
    pubky,
  });

  return async () => {
    const restored = await localIdentities.restore();
    if (Result.isError(restored)) {
      return Result.err({
        code: restored.error.code === "no_active_identity"
          ? "no_active_identity"
          : "identity_restore_failed",
      });
    }
    return Result.ok(restored.value);
  };
}
