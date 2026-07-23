"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import { GoogleBackedIdentityFlow } from "../browser/identity/google/googleBackedIdentityFlow";
import { BrowserGoogleHomegateInviteRequester } from "../browser/identity/google/googleHomegateInviteRequester";
import { BrowserGoogleWrappingKeyRequester } from "../browser/identity/google/googleWrappingKeyRequester";
import { LocalStorageIdentityRepository } from "../browser/identity/localIdentityRepository";
import { GoogleDrivePassportFileRepository } from "../browser/passport-file/googleDrivePassportFileRepository";
import { WebCryptoPassportFileCrypto } from "../browser/passport-file/webCryptoPassportFileCrypto";
import { BrowserPubky } from "../browser/pubky/browserPubky";
import type { LocalIdentitySummary } from "../features/identity/localIdentity";
import type { PubkyIdentityKeyHandle, PubkyPublicIdentity } from "../features/identity/pubkyIdentity";
import { logger } from "../libs/logger/logger";
import { GoogleSignInButton } from "./googleSignInButton";

type GoogleAction = "add" | "delete-selected" | "delete-failed" | null;

export function DevelopmentIdentityPanel({
  googleClientId,
  allowGoogleDriveReset,
  passportUrl,
}: {
  googleClientId: string;
  allowGoogleDriveReset: boolean;
  passportUrl: string;
}) {
  const pubky = useRef<BrowserPubky | null>(null);
  const activeKeyHandle = useRef<PubkyIdentityKeyHandle | null>(null);
  const operation = useRef(0);
  const [identities, setIdentities] = useState<LocalIdentitySummary[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const [googleAction, setGoogleAction] = useState<GoogleAction>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ready.");
  const [recoverableDriveIdentity, setRecoverableDriveIdentity] = useState<PubkyPublicIdentity | null>(null);

  useEffect(() => {
    refreshIdentities();
    return () => pubky.current?.dispose();
  }, []);

  function refreshIdentities(nextMessage?: string): void {
    const stored = new LocalStorageIdentityRepository().list();
    if (Result.isError(stored)) {
      setIdentities([]);
      setSelectedIdentityId("");
      setMessage("Could not read local identities.");
      return;
    }

    setIdentities(stored.value.identities);
    setSelectedIdentityId(stored.value.activeIdentityId ?? "");
    if (nextMessage) setMessage(nextMessage);
  }

  function selectIdentity(id: string): void {
    const selected = new LocalStorageIdentityRepository().select(id);
    if (Result.isError(selected)) {
      setMessage("Could not select that identity.");
      return;
    }

    disposeActiveKey();
    setSelectedIdentityId(id);
    setMessage("Identity selected.");
  }

  function getPubky(): BrowserPubky | null {
    try {
      pubky.current ??= new BrowserPubky();
      return pubky.current;
    } catch {
      logger.warn("identity.pubky.initialize.failed");
      setMessage("Could not initialize Pubky in this browser.");
      return null;
    }
  }

  function createIdentityFlow(pubkyAdapter: BrowserPubky): GoogleBackedIdentityFlow {
    return new GoogleBackedIdentityFlow({
      wrappingKeys: new BrowserGoogleWrappingKeyRequester(),
      passportFilesForAccessToken: (token) => new GoogleDrivePassportFileRepository({
        accessTokenProvider: async () => token,
        fetch: globalThis.fetch.bind(globalThis),
        allowLocalhostHttp: new URL(passportUrl).protocol === "http:",
      }),
      crypto: new WebCryptoPassportFileCrypto(),
      identityKeys: pubkyAdapter,
      homegateInvites: new BrowserGoogleHomegateInviteRequester(),
      signup: pubkyAdapter,
      discovery: pubkyAdapter,
      localIdentities: new LocalStorageIdentityRepository(),
      passportUrl,
    });
  }

  async function createOrRestoreIdentity(googleIdToken: string, driveAccessToken: string): Promise<void> {
    const activeOperation = operation.current;
    setBusy(true);
    try {
      const pubkyAdapter = getPubky();
      if (!pubkyAdapter || operation.current !== activeOperation) return;

      disposeActiveKey();
      const flow = createIdentityFlow(pubkyAdapter);
      if (operation.current !== activeOperation) return;
      const identity = await flow.establish({ googleIdToken, driveAccessToken });
      if (Result.isError(identity)) {
        logger.warn("identity.google.establish.failed", { code: identity.error.code });
        setRecoverableDriveIdentity(identity.error.recoverablePublicIdentity ?? null);
        setMessage(messageForGoogleFailure(identity.error.code));
        return;
      }

      setRecoverableDriveIdentity(null);
      activeKeyHandle.current = identity.value.keyHandle;
      refreshIdentities(identity.value.source === "created" ? "Identity created." : "Identity restored.");
    } catch {
      logger.warn("identity.google.establish.failed", { code: "unexpected" });
      setMessage("Could not add the Google-backed identity.");
    } finally {
      if (operation.current === activeOperation) {
        setBusy(false);
        setGoogleAction(null);
      }
    }
  }

  async function deleteIdentityFromGoogle(
    googleIdToken: string,
    driveAccessToken: string,
    expectedPublicIdentity: PubkyPublicIdentity | undefined,
    target: "selected" | "failed",
  ): Promise<void> {
    const activeOperation = operation.current;
    if (!allowGoogleDriveReset || !expectedPublicIdentity) return;

    setBusy(true);
    try {
      const pubkyAdapter = getPubky();
      if (!pubkyAdapter || operation.current !== activeOperation) return;

      const flow = createIdentityFlow(pubkyAdapter);
      if (operation.current !== activeOperation) return;
      const deleted = await flow.deleteIdentity(
        { googleIdToken, driveAccessToken },
        expectedPublicIdentity.publicKeyZ32,
      );
      if (Result.isError(deleted)) {
        setMessage(messageForGoogleFailure(deleted.error.code));
      } else {
        if (target === "failed") setRecoverableDriveIdentity(null);
        setMessage("Identity deleted from Google Drive.");
      }
    } catch {
      logger.warn("identity.google.delete.failed", { code: "unexpected" });
      setMessage("Could not delete the identity from Google Drive.");
    } finally {
      if (operation.current === activeOperation) {
        setBusy(false);
        setGoogleAction(null);
      }
    }
  }

  function clearLocalIdentities(): void {
    const cleared = new LocalStorageIdentityRepository().clear();
    if (Result.isError(cleared)) {
      setMessage("Could not clear local identities.");
      return;
    }

    disposeActiveKey();
    refreshIdentities("Local identities cleared.");
  }

  function disposeActiveKey(): void {
    if (activeKeyHandle.current && pubky.current) {
      pubky.current.disposeIdentityKey({ keyHandle: activeKeyHandle.current });
      activeKeyHandle.current = null;
    }
  }

  const selectedIdentity = identities.find((identity) => identity.id === selectedIdentityId);

  function beginGoogleAction(action: Exclude<GoogleAction, null>): void {
    operation.current += 1;
    setGoogleAction(action);
  }

  function cancelGoogleAction(): void {
    operation.current += 1;
    setBusy(false);
    setGoogleAction(null);
  }

  return (
    <section className="flex flex-col gap-4 rounded border p-4">
      <h2 className="font-medium">Identities</h2>
      <select
        aria-label="Selected identity"
        autoComplete="off"
        disabled={busy || googleAction !== null || identities.length === 0}
        onChange={(event) => selectIdentity(event.target.value)}
        suppressHydrationWarning
        value={selectedIdentityId}
      >
        {identities.length === 0 ? <option value="">None</option> : null}
        {identities.map((identity) => (
          <option key={identity.id} value={identity.id}>{identity.publicIdentity.publicKeyDisplay}</option>
        ))}
      </select>

      {googleAction === null ? (
        <div className="flex flex-wrap gap-2">
          <button className="rounded border px-3 py-2" disabled={busy} onClick={() => beginGoogleAction("add")} type="button">Add identity</button>
          {allowGoogleDriveReset && selectedIdentity ? (
            <button
              className="rounded border border-red-700 px-3 py-2 text-red-700"
              disabled={busy}
              onClick={() => {
                if (globalThis.confirm("Authorize Google again, verify the selected identity, and delete its Passport Drive file?")) {
                  beginGoogleAction("delete-selected");
                }
              }}
              type="button"
            >
              Delete identity from Google
            </button>
          ) : null}
          {allowGoogleDriveReset && recoverableDriveIdentity ? (
            <button
              className="rounded border border-red-700 px-3 py-2 text-red-700"
              disabled={busy}
              onClick={() => {
                if (globalThis.confirm("Authorize Google again, verify the identity that could not be activated, and delete its Passport Drive file?")) {
                  beginGoogleAction("delete-failed");
                }
              }}
              type="button"
            >
              Delete failed identity from Google
            </button>
          ) : null}
          {allowGoogleDriveReset && identities.length > 0 ? (
            <button
              className="rounded border border-red-700 px-3 py-2 text-red-700"
              disabled={busy}
              onClick={() => {
                if (globalThis.confirm("Clear all Passport identities stored in this browser? Google Drive data will not be changed.")) {
                  clearLocalIdentities();
                }
              }}
              type="button"
            >
              Clear local identities
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded border p-3">
          <p>{googleAction === "add"
            ? "Authorize Google to create or restore an identity."
            : googleAction === "delete-selected"
              ? "Authorize Google again to delete the selected identity."
              : "Authorize Google again to delete the identity that could not be activated."}</p>
          <GoogleSignInButton
            clientId={googleClientId}
            disabled={busy}
            onAuthorized={googleAction === "add"
              ? createOrRestoreIdentity
              : googleAction === "delete-selected"
                ? (googleIdToken, driveAccessToken) => deleteIdentityFromGoogle(
                  googleIdToken,
                  driveAccessToken,
                  selectedIdentity?.publicIdentity,
                  "selected",
                )
                : (googleIdToken, driveAccessToken) => deleteIdentityFromGoogle(
                  googleIdToken,
                  driveAccessToken,
                  recoverableDriveIdentity ?? undefined,
                  "failed",
                )}
          />
          <button className="rounded border px-3 py-2" disabled={busy} onClick={cancelGoogleAction} type="button">Cancel</button>
        </div>
      )}

      <p aria-live="polite" className="text-sm text-neutral-600">{message}</p>
    </section>
  );
}

function messageForGoogleFailure(code: string): string {
  switch (code) {
    case "wrapping_key_failed":
      return "Passport could not obtain wrapping material.";
    case "drive_read_failed":
      return "Passport could not read this identity from Google Drive.";
    case "decrypt_failed":
      return "Passport could not decrypt this Google Drive identity.";
    case "identity_mismatch":
      return "The authorized Google account does not contain the selected identity.";
    case "drive_delete_failed":
      return "Passport could not delete the identity from Google Drive.";
    case "drive_stale_file":
      return "The Google Drive identity changed before it could be deleted. Try again.";
    case "drive_create_conflict":
      return "A Google Drive identity was created at the same time. Try again to restore it.";
    case "homegate_invite_failed":
      return "Passport stored the encrypted identity, but could not obtain a homeserver invitation. Delete the failed Drive identity and start again.";
    case "signup_failed":
      return "Passport stored the encrypted identity, but homeserver signup did not complete. Delete the failed Drive identity and start again.";
    case "signin_failed":
      return "Passport restored the identity, but could not activate its homeserver session. Delete the failed Drive identity and start again.";
    case "discovery_failed":
      return "Passport signed up the identity, but could not publish its homeserver discovery record. Try restoring it again.";
    default:
      return "The Google identity operation failed.";
  }
}
