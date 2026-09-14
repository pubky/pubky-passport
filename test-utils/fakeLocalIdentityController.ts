import { Result } from "better-result";

import type { LocalIdentityCatalog } from "../src/client/logic/local-identity/localIdentityModels";
import type { PassportCollaborators } from "../src/client/ui/passportCollaborators";

type LocalIdentityControllerFake = ReturnType<
  PassportCollaborators["createLocalIdentityController"]
>;

export function fakeLocalIdentityController(
  state: {
    catalog?: LocalIdentityCatalog | undefined;
    listener?: (() => void) | undefined;
    storageUnavailable?: boolean | undefined;
  },
  overrides: Partial<LocalIdentityControllerFake> = {},
): LocalIdentityControllerFake {
  return {
    createPubkyRingMigration:
      overrides.createPubkyRingMigration ??
      (async () => Result.err({ code: "invalid_identity" as const })),
    createRecoveryFile:
      overrides.createRecoveryFile ??
      (async () => Result.err({ code: "recovery_file_failed" as const })),
    listIdentities:
      overrides.listIdentities ??
      (() =>
        state.storageUnavailable || !state.catalog
          ? Result.err({ code: "storage_unavailable" as const })
          : Result.ok(state.catalog)),
    removeIdentity:
      overrides.removeIdentity ??
      ((publicKeyZ32) => {
        if (!state.catalog) return Result.err({ code: "storage_unavailable" as const });
        const identities = state.catalog.identities.filter(
          (identity) => identity.publicIdentity.publicKeyZ32 !== publicKeyZ32,
        );
        state.catalog = {
          activePublicKeyZ32: identities[0]?.publicIdentity.publicKeyZ32 ?? null,
          identities,
        };
        state.listener?.();
        return Result.ok();
      }),
    resolveHomeserver: overrides.resolveHomeserver ?? (async () => Result.ok(null)),
    selectIdentity:
      overrides.selectIdentity ??
      ((publicKeyZ32) => {
        if (!state.catalog) return Result.err({ code: "storage_unavailable" as const });
        state.catalog = { ...state.catalog, activePublicKeyZ32: publicKeyZ32 };
        state.listener?.();
        return Result.ok();
      }),
    subscribeToIdentityChanges:
      overrides.subscribeToIdentityChanges ??
      ((listener) => {
        state.listener = listener;
        return () => {
          state.listener = undefined;
        };
      }),
  };
}
