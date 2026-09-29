import { Result } from "better-result";
import { useState, useSyncExternalStore } from "react";

import type {
  LocalIdentityBackupCheckResult,
  LocalIdentityHomeserverRepublishResult,
  LocalIdentityRecoveryFileResult,
} from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyHomeserverResolutionResult } from "@/client/logic/pubky/pubkyIdentityKey";
import type { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import {
  usePassportCollaborators,
  type LocalIdentityControllerPort,
  type PassportCollaborators,
} from "@/client/ui/passportCollaborators";

type IdentityCatalogActions = {
  createMigration: (publicKeyZ32: string) => Promise<LocalIdentityResult<PubkyRingMigration>>;
  createRecoveryFile: (
    publicKeyZ32: string,
    password: string,
  ) => Promise<LocalIdentityRecoveryFileResult>;
  removeIdentity: (publicKeyZ32: string) => LocalIdentityResult<void>;
  republishHomeserver: (
    publicKeyZ32: string,
    homeserverPubky: string,
  ) => Promise<LocalIdentityHomeserverRepublishResult>;
  resolveHomeserver: (publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult>;
  selectIdentity: (publicKeyZ32: string) => LocalIdentityResult<void>;
  /** Opens a backup file of the identity with its password and records that it was checked. */
  verifyRecoveryFile: (
    publicKeyZ32: string,
    recoveryFile: Uint8Array,
    password: string,
  ) => Promise<LocalIdentityBackupCheckResult>;
};

type IdentityCatalogState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; catalog: LocalIdentityCatalog; actions: IdentityCatalogActions };

const SERVER_SNAPSHOT: IdentityCatalogState = { status: "loading" };

class IdentityCatalogStore {
  private readonly controller: LocalIdentityControllerPort;
  private dirty = true;
  private snapshot: IdentityCatalogState | undefined;

  readonly actions: IdentityCatalogActions;

  constructor(createController: PassportCollaborators["createLocalIdentityController"]) {
    this.controller = createController();
    this.actions = {
      createMigration: async (publicKeyZ32) =>
        this.controller.createPubkyRingMigration(publicKeyZ32),
      createRecoveryFile: async (publicKeyZ32, password) =>
        this.controller.createRecoveryFile(publicKeyZ32, password),
      removeIdentity: (publicKeyZ32) => this.controller.removeIdentity(publicKeyZ32),
      republishHomeserver: async (publicKeyZ32, homeserverPubky) =>
        this.controller.republishHomeserver(publicKeyZ32, homeserverPubky),
      resolveHomeserver: async (publicKeyZ32) => this.controller.resolveHomeserver(publicKeyZ32),
      selectIdentity: (publicKeyZ32) => this.controller.selectIdentity(publicKeyZ32),
      verifyRecoveryFile: async (publicKeyZ32, recoveryFile, password) =>
        this.controller.verifyRecoveryFile(publicKeyZ32, recoveryFile, password),
    };
  }

  getSnapshot = (): IdentityCatalogState => {
    if (!this.dirty && this.snapshot) return this.snapshot;
    const catalog = this.controller.listIdentities();
    this.snapshot = Result.isOk(catalog)
      ? { status: "ready", catalog: catalog.value, actions: this.actions }
      : { status: "unavailable" };
    this.dirty = false;
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    return this.controller.subscribeToIdentityChanges(() => {
      this.dirty = true;
      listener();
    });
  };
}

function useIdentityCatalog(): IdentityCatalogState {
  const { createLocalIdentityController } = usePassportCollaborators();
  const [store] = useState(() => new IdentityCatalogStore(createLocalIdentityController));
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => SERVER_SNAPSHOT);
}

export { useIdentityCatalog, type IdentityCatalogActions };
