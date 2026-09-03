import { Result } from "better-result";
import { useState, useSyncExternalStore } from "react";
import { LOGGER, safeErrorLogFields } from "../../../libs/logger/logger";

import {
  LocalIdentityController,
  type LocalIdentityRecoveryFileResult,
} from "../../logic/local-identity/LocalIdentityController";
import type { LocalIdentityResult } from "../../logic/local-identity/IndexedDbIdentityRepository";
import type { LocalIdentityCatalog } from "../../logic/local-identity/localIdentityModels";
import type { PubkyHomeserverResolutionResult } from "../../logic/pubky/pubkyIdentityKey";
import type { PubkyRingMigration } from "../../logic/pubky/PubkySdkAdapter";

type IdentityCatalogActions = {
  createMigration: (publicKeyZ32: string) => Promise<LocalIdentityResult<PubkyRingMigration>>;
  createRecoveryFile: (
    publicKeyZ32: string,
    password: string,
  ) => Promise<LocalIdentityRecoveryFileResult>;
  removeIdentity: (publicKeyZ32: string) => Promise<LocalIdentityResult<void>>;
  resolveHomeserver: (publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult>;
  selectIdentity: (publicKeyZ32: string) => Promise<LocalIdentityResult<void>>;
};

type IdentityCatalogState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; catalog: LocalIdentityCatalog; actions: IdentityCatalogActions };

const SERVER_SNAPSHOT: IdentityCatalogState = { status: "loading" };

class IdentityCatalogStore {
  private readonly controller = new LocalIdentityController();
  private readonly listeners = new Set<() => void>();
  private snapshot: IdentityCatalogState = { status: "loading" };
  private refreshRequest = 0;
  private unsubscribeFromIdentityChanges: (() => void) | undefined;

  readonly actions: IdentityCatalogActions;

  constructor() {
    this.actions = {
      createMigration: (publicKeyZ32) => this.controller.createPubkyRingMigration(publicKeyZ32),
      createRecoveryFile: (publicKeyZ32, password) =>
        this.controller.createRecoveryFile(publicKeyZ32, password),
      removeIdentity: (publicKeyZ32) => this.controller.removeIdentity(publicKeyZ32),
      resolveHomeserver: (publicKeyZ32) => this.controller.resolveHomeserver(publicKeyZ32),
      selectIdentity: (publicKeyZ32) => this.controller.selectIdentity(publicKeyZ32),
    };
  }

  getSnapshot = (): IdentityCatalogState => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.unsubscribeFromIdentityChanges = this.controller.subscribeToIdentityChanges(() => {
        void this.refresh();
      });
      void this.refresh();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;
      this.refreshRequest += 1;
      this.unsubscribeFromIdentityChanges?.();
      this.unsubscribeFromIdentityChanges = undefined;
    };
  };

  private async refresh(): Promise<void> {
    const request = ++this.refreshRequest;
    let snapshot: IdentityCatalogState;
    try {
      const catalog = await this.controller.listIdentities();
      snapshot = Result.isOk(catalog)
        ? { status: "ready", catalog: catalog.value, actions: this.actions }
        : { status: "unavailable" };
    } catch (e) {
      // Storage exceptions may include record data, so only redacted diagnostics are logged.
      LOGGER.error("identity.catalog.failed", {
        operation: "refresh",
        code: "unexpected_failure",
        ...safeErrorLogFields(e),
      });
      snapshot = { status: "unavailable" };
    }
    if (request !== this.refreshRequest) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

function useIdentityCatalog(): IdentityCatalogState {
  const [store] = useState(() => new IdentityCatalogStore());
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => SERVER_SNAPSHOT);
}

export { useIdentityCatalog, type IdentityCatalogActions };
