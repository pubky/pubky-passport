import "client-only";

import { Result } from "better-result";

import { LOGGER } from "@/libs/logger/logger";
import { LocalStorageIdentityRepository } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import { LocalAccountDraftRepository, type LocalAccountDraft } from "./LocalAccountDraftRepository";

// Kept apart from LocalAccountSetupController, which loads the Pubky SDK: the pages read the
// unfinished account on their first render, before any SDK is needed.

type CatalogPort = Pick<LocalStorageIdentityRepository, "list">;

/**
 * Reads the unfinished local account without writing storage, so render code may call it. A
 * draft whose key is already in the signing catalog finished registering: it counts as no
 * unfinished account, and {@link releaseFinishedAccount} removes it.
 */
export function readUnfinishedAccount(
  drafts: Pick<LocalAccountDraftRepository, "read"> = new LocalAccountDraftRepository(),
  repository: CatalogPort = new LocalStorageIdentityRepository(),
): ReturnType<LocalAccountDraftRepository["read"]> {
  const saved = drafts.read();
  if (Result.isError(saved) || !saved.value) return saved;
  return isDraftRegistered(saved.value, repository) ? Result.ok(null) : saved;
}

/**
 * Removes a draft that outlived its finished registration, so it no longer blocks choosing a
 * signer or changing the invite. Writes storage: call it from an effect or event handler, never
 * during render. An unfinished draft is left alone.
 */
export function releaseFinishedAccount(
  drafts: Pick<LocalAccountDraftRepository, "read" | "remove"> = new LocalAccountDraftRepository(),
  repository: CatalogPort = new LocalStorageIdentityRepository(),
): void {
  const saved = drafts.read();
  if (Result.isOk(saved) && saved.value) releaseRegisteredDraft(saved.value, drafts, repository);
}

function isDraftRegistered(draft: LocalAccountDraft, repository: CatalogPort): boolean {
  const catalog = repository.list();
  return (
    Result.isOk(catalog) &&
    catalog.value.identities.some(
      (entry) => entry.publicIdentity.publicKeyZ32 === draft.publicIdentity.publicKeyZ32,
    )
  );
}

/**
 * Removes a draft whose key already signs from the catalog: registration finished but the
 * draft outlived it. Returns false when the draft is still unfinished or could not be removed.
 */
export function releaseRegisteredDraft(
  draft: LocalAccountDraft,
  drafts: Pick<LocalAccountDraftRepository, "remove">,
  repository: CatalogPort,
): boolean {
  if (!isDraftRegistered(draft, repository)) return false;
  const removed = drafts.remove(draft.publicIdentity.publicKeyZ32);
  if (Result.isError(removed)) {
    LOGGER.warn("identity.local_account.cleanup.failed", {
      operation: "release_registered_draft",
      code: removed.error.code,
    });
    return false;
  }
  return true;
}
