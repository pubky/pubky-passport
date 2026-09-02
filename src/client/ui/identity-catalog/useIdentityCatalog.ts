import { Result } from "better-result";
import { useState, useSyncExternalStore } from "react";
import { LOGGER, safeErrorLogFields } from "../../../libs/logger/logger";

import {
  LocalIdentityController,
  type LocalIdentityRecoveryFileResult,
} from "../../logic/local-identity/LocalIdentityController";
import type { LocalIdentityResult } from "../../logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityCatalog } from "../../logic/local-identity/localIdentityModels";
import type { PubkyHomeserverResolutionResult } from "../../logic/pubky/pubkyIdentityKey";
import type { PubkyRingMigration } from "../../logic/pubky/PubkySdkAdapter";

type IdentityCatalogActions = {
  createMigration: (publicKeyZ32: string) => Promise<LocalIdentityResult<PubkyRingMigration>>;
  createRecoveryFile: (
    publicKeyZ32: string,
    password: string,
  ) => Promise<LocalIdentityRecoveryFileResult>;
  removeIdentity: (publicKeyZ32: string) => LocalIdentityResult<void>;
  resolveHomeserver: (publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult>;
  selectIdentity: (publicKeyZ32: string) => LocalIdentityResult<void>;
};

type IdentityCatalogState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; catalog: LocalIdentityCatalog; actions: IdentityCatalogActions };

const SERVER_SNAPSHOT: IdentityCatalogState = { status: "loading" };

class IdentityCatalogStore {
  private readonly controller: LocalIdentityController | null;
  private readonly initializationCause: unknown;
  private dirty = true;
  private snapshot: IdentityCatalogState | undefined;

  readonly actions: IdentityCatalogActions;

  constructor() {
    try {
      this.controller = new LocalIdentityController();
      this.initializationCause = undefined;
    } catch (e) {
      this.controller = null;
      this.initializationCause = e;
      LOGGER.error("identity.catalog.failed", {
        operation: "initialize",
        code: "controller_unavailable",
        ...safeErrorLogFields(e),
      });
    }
    this.actions = {
      createMigration: async (publicKeyZ32) =>
        this.controller
          ? this.controller.createPubkyRingMigration(publicKeyZ32)
          : Result.err({ code: "storage_unavailable", cause: this.initializationCause }),
      createRecoveryFile: async (publicKeyZ32, password) =>
        this.controller
          ? this.controller.createRecoveryFile(publicKeyZ32, password)
          : Result.err({ code: "identity_unavailable", cause: this.initializationCause }),
      removeIdentity: (publicKeyZ32) =>
        this.controller?.removeIdentity(publicKeyZ32) ??
        Result.err({ code: "storage_unavailable", cause: this.initializationCause }),
      resolveHomeserver: async (publicKeyZ32) =>
        this.controller
          ? this.controller.resolveHomeserver(publicKeyZ32)
          : Result.err({ code: "resolution_failed", cause: this.initializationCause }),
      selectIdentity: (publicKeyZ32) =>
        this.controller?.selectIdentity(publicKeyZ32) ??
        Result.err({ code: "storage_unavailable", cause: this.initializationCause }),
    };
  }

  getSnapshot = (): IdentityCatalogState => {
    if (!this.dirty && this.snapshot) return this.snapshot;
    const catalog = this.controller?.listIdentities();
    this.snapshot =
      catalog && Result.isOk(catalog)
        ? { status: "ready", catalog: catalog.value, actions: this.actions }
        : { status: "unavailable" };
    this.dirty = false;
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    if (!this.controller) return () => undefined;
    return this.controller.subscribeToIdentityChanges(() => {
      this.dirty = true;
      listener();
    });
  };
}

function useIdentityCatalog(): IdentityCatalogState {
  const [store] = useState(() => new IdentityCatalogStore());
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => SERVER_SNAPSHOT);
}

export { useIdentityCatalog, type IdentityCatalogActions };
