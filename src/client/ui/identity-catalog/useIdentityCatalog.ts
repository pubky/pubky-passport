import { Result } from "better-result";
import { useState, useSyncExternalStore } from "react";

import {
  LocalIdentityController,
  type LocalIdentityRecoveryFileResult,
} from "../../logic/local-identity/LocalIdentityController";
import type { LocalIdentityCatalog } from "../../logic/local-identity/localIdentityModels";
import type { PubkyHomeserverResolutionResult } from "../../logic/pubky/pubkyIdentityKey";

type IdentityCatalogActions = {
  createMigrationUrl: (publicKeyZ32: string) => string | null;
  createRecoveryFile: (
    publicKeyZ32: string,
    password: string,
  ) => Promise<LocalIdentityRecoveryFileResult>;
  removeIdentity: (publicKeyZ32: string) => boolean;
  resolveHomeserver: (publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult>;
  selectIdentity: (publicKeyZ32: string) => boolean;
};

type IdentityCatalogState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; catalog: LocalIdentityCatalog; actions: IdentityCatalogActions };

const SERVER_SNAPSHOT: IdentityCatalogState = { status: "loading" };

class IdentityCatalogStore {
  private readonly controller: LocalIdentityController | null;
  private dirty = true;
  private snapshot: IdentityCatalogState | undefined;

  readonly actions: IdentityCatalogActions;

  constructor() {
    try {
      this.controller = new LocalIdentityController();
    } catch {
      this.controller = null;
    }
    this.actions = {
      createMigrationUrl: (publicKeyZ32) => {
        const result = this.controller?.createPubkyRingMigrationUrl(publicKeyZ32);
        return result && Result.isOk(result) ? result.value : null;
      },
      createRecoveryFile: async (publicKeyZ32, password) => this.controller
        ? this.controller.createRecoveryFile(publicKeyZ32, password)
        : Result.err({ code: "identity_unavailable" }),
      removeIdentity: (publicKeyZ32) => Result.isOk(
        this.controller?.removeIdentity(publicKeyZ32)
          ?? Result.err({ code: "storage_unavailable" }),
      ),
      resolveHomeserver: async (publicKeyZ32) => this.controller
        ? this.controller.resolveHomeserver(publicKeyZ32)
        : Result.err({ code: "resolution_failed" }),
      selectIdentity: (publicKeyZ32) => Result.isOk(
        this.controller?.selectIdentity(publicKeyZ32)
          ?? Result.err({ code: "storage_unavailable" }),
      ),
    };
  }

  getSnapshot = (): IdentityCatalogState => {
    if (!this.dirty && this.snapshot) return this.snapshot;
    const catalog = this.controller?.listIdentities();
    this.snapshot = catalog && Result.isOk(catalog)
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

export {
  useIdentityCatalog,
  type IdentityCatalogActions,
  type IdentityCatalogState,
};
