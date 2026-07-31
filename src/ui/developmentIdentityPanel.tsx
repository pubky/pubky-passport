"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import type {
  GoogleBackedIdentityActionResult,
  LocalIdentitySummary,
  PassportIdentityController,
} from "../browser/identity/passportIdentity";
import { createPassportIdentityController } from "../browser/identity/passportIdentity";
import type { PubkyPublicIdentity } from "../core/identity/pubkyIdentity";
import { GoogleBackedIdentityActionPanel } from "./googleBackedIdentityActionPanel";

type GoogleAction = "add" | "delete-selected" | "delete-failed" | null;

export function DevelopmentIdentityPanel({
  googleClientId,
  homegateBaseUrl,
  allowGoogleDrivePassportFileDeletion,
}: {
  googleClientId: string;
  homegateBaseUrl: string;
  allowGoogleDrivePassportFileDeletion: boolean;
}) {
  const controller = useRef<PassportIdentityController | null>(null);
  const googleActionTarget = useRef<string | null>(null);
  const [controllerReady, setControllerReady] = useState(false);
  const [identities, setIdentities] = useState<LocalIdentitySummary[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const [googleAction, setGoogleAction] = useState<GoogleAction>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ready.");
  const [passportFileCleanupCandidate, setPassportFileCleanupCandidate] = useState<PubkyPublicIdentity | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => { };
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        controller.current = createPassportIdentityController({ googleClientId, homegateBaseUrl });
        setControllerReady(true);
        unsubscribe = controller.current.subscribe(() => refreshIdentities());
        refreshIdentities();
      } catch {
        setMessage("Could not initialize Pubky in this browser.");
      }
    });
    return () => {
      cancelled = true;
      try {
        unsubscribe();
      } catch { /* Continue remaining cleanup. */ }
      try {
        controller.current?.dispose();
      } catch { /* The browser controller owns disposal logging. */ }
      controller.current = null;
    };
  }, [googleClientId, homegateBaseUrl]);

  function refreshIdentities(nextMessage?: string): void {
    let stored: ReturnType<PassportIdentityController["list"]> | undefined;
    try {
      stored = controller.current?.list();
    } catch { /* The browser controller owns operation logging. */ }
    if (!stored || Result.isError(stored)) {
      setIdentities([]);
      setSelectedIdentityId("");
      setMessage("Could not read local Pubky identities.");
      return;
    }

    setIdentities(stored.value.identities);
    setSelectedIdentityId(stored.value.activeIdentityId ?? "");
    if (nextMessage) setMessage(nextMessage);
  }

  function selectIdentity(id: string): void {
    let selected: ReturnType<PassportIdentityController["select"]> | undefined;
    try {
      selected = controller.current?.select(id);
    } catch { /* The browser controller owns operation logging. */ }
    if (!selected || Result.isError(selected)) {
      setMessage("Could not select that Pubky identity.");
      return;
    }

    setSelectedIdentityId(id);
    setMessage("Pubky identity selected.");
  }

  function completeGoogleAction(result: GoogleBackedIdentityActionResult): void {
    if (Result.isError(result)) {
      const creationCleanupCandidate = googleAction === "add"
        ? result.error.partialSetupPublicIdentity ?? null
        : null;
      setPassportFileCleanupCandidate(creationCleanupCandidate);
      setMessage(messageForGoogleFailure(result.error.code, creationCleanupCandidate !== null));
    } else if (result.value.kind === "google_backed_identity_established") {
      setPassportFileCleanupCandidate(null);
      refreshIdentities(result.value.establishmentMode === "created" ? "Pubky identity created." : "Pubky identity restored.");
    } else {
      if (googleAction === "delete-failed") setPassportFileCleanupCandidate(null);
      setMessage("Google Drive Passport file deleted.");
    }
    setBusy(false);
    googleActionTarget.current = null;
    setGoogleAction(null);
  }

  function clearLocalIdentities(): void {
    let cleared: ReturnType<PassportIdentityController["clear"]> | undefined;
    try {
      cleared = controller.current?.clear();
    } catch { /* The browser controller owns operation logging. */ }
    if (!cleared || Result.isError(cleared)) {
      setMessage("Could not clear local Pubky identities.");
      return;
    }

    refreshIdentities("Local Pubky identities cleared.");
  }

  const selectedIdentity = identities.find((identity) => identity.id === selectedIdentityId);

  function beginGoogleAction(action: Exclude<GoogleAction, null>, target: string | null = null): void {
    googleActionTarget.current = target;
    setGoogleAction(action);
  }

  function cancelGoogleAction(): void {
    try {
      controller.current?.unmountGoogleSignIn();
    } catch { /* The browser controller owns cleanup logging. */ }
    setBusy(false);
    googleActionTarget.current = null;
    setGoogleAction(null);
  }

  const googleIdentityAction = googleAction === "add"
    ? { kind: "establish_google_backed_identity" } as const
    : googleAction === "delete-selected" && googleActionTarget.current
      ? { kind: "delete_google_drive_passport_file", expectedPublicKeyZ32: googleActionTarget.current } as const
      : googleAction === "delete-failed" && googleActionTarget.current
        ? { kind: "delete_google_drive_passport_file", expectedPublicKeyZ32: googleActionTarget.current } as const
        : null;

  return (
    <section className="flex flex-col gap-4 rounded border p-4">
      <h2 className="font-medium">Pubky identities</h2>
      <select
        aria-label="Selected Pubky identity"
        autoComplete="off"
        className="w-full min-w-0 max-w-full"
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
          <button className="rounded border px-3 py-2" disabled={busy || !controllerReady} onClick={() => beginGoogleAction("add")} type="button">Add Pubky identity</button>
          {allowGoogleDrivePassportFileDeletion && selectedIdentity ? (
            <button
              className="rounded border border-red-700 px-3 py-2 text-red-700"
              disabled={busy}
              onClick={() => {
                if (globalThis.confirm("Authorize Google Drive again, verify the selected Pubky identity, and delete its Passport file?")) {
                  beginGoogleAction("delete-selected", selectedIdentity.publicIdentity.publicKeyZ32);
                }
              }}
              type="button"
            >
              Delete Google Drive Passport file
            </button>
          ) : null}
          {allowGoogleDrivePassportFileDeletion && passportFileCleanupCandidate ? (
            <button
              className="rounded border border-red-700 px-3 py-2 text-red-700"
              disabled={busy}
              onClick={() => {
                if (globalThis.confirm("Authorize Google Drive again, verify the Pubky identity that could not be activated, and delete its Passport file?")) {
                  beginGoogleAction("delete-failed", passportFileCleanupCandidate.publicKeyZ32);
                }
              }}
              type="button"
            >
              Delete partial setup Passport file
            </button>
          ) : null}
          {allowGoogleDrivePassportFileDeletion && identities.length > 0 ? (
            <button
              className="rounded border border-red-700 px-3 py-2 text-red-700"
              disabled={busy}
              onClick={() => {
                if (globalThis.confirm("Clear all Pubky identities stored in this browser? Google Drive data will not be changed.")) clearLocalIdentities();
              }}
              type="button"
            >
              Clear local Pubky identities
            </button>
          ) : null}
        </div>
      ) : googleIdentityAction && controller.current ? (
        <div className="flex flex-col items-start gap-3 rounded border p-3">
          <p>{googleAction === "add"
            ? "Sign in with your Google account and authorize Google Drive to create or restore a Pubky identity."
            : googleAction === "delete-selected"
              ? "Authorize Google Drive again to delete the selected Pubky identity's Passport file."
              : "Authorize Google Drive again to delete the partial setup Passport file."}</p>
          <GoogleBackedIdentityActionPanel
            action={googleIdentityAction}
            controller={controller.current}
            disabled={busy}
            onActionCompleted={completeGoogleAction}
            onBusyChange={setBusy}
          />
          <button className="rounded border px-3 py-2" disabled={busy} onClick={cancelGoogleAction} type="button">
            {googleAction === "add" ? "Cancel identity setup" : "Cancel file deletion"}
          </button>
        </div>
      ) : null}

      <p aria-live="polite" className="text-sm text-neutral-600">{message}</p>
    </section>
  );
}

function messageForGoogleFailure(code: string, hasCreationCleanupCandidate: boolean): string {
  switch (code) {
    case "wrapping_key_failed":
      return "Passport could not obtain the wrapping key.";
    case "wrapping_key_rate_limited":
      return "Too many wrapping-key requests were made for this account. Try again later.";
    case "wrapping_key_unavailable":
      return "Passport's wrapping-key service is temporarily unavailable. Try again later.";
    case "drive_read_failed":
      return "Passport could not read the Google Drive Passport file.";
    case "decrypt_failed":
      return "Passport could not decrypt the Google Drive Passport file.";
    case "identity_mismatch":
      return "The Google Drive Passport file belongs to a different Pubky identity than expected.";
    case "drive_delete_failed":
      return "Passport could not delete the Google Drive Passport file.";
    case "drive_stale_file":
      return "The Google Drive Passport file changed before it could be deleted. Try again.";
    case "drive_create_conflict":
      return "A Google Drive Passport file was created at the same time. Try again to restore it.";
    case "invalid_google_id_token":
      return "Your Google account session is no longer valid. Sign in again to continue.";
    case "weekly_limit_exceeded":
      return "This Google account reached its weekly homeserver signup limit. Passport did not create a Pubky identity; retry later.";
    case "annual_limit_exceeded":
      return "This Google account reached its annual homeserver signup limit. Passport did not create a Pubky identity; retry later.";
    case "homeserver_unavailable":
      return "The homeserver is unavailable. Passport did not create a Pubky identity; retry later.";
    case "google_verifier_unavailable":
    case "homegate_unavailable":
    case "network_failed":
      return "The invitation service is unavailable. Passport did not create a Pubky identity; retry later.";
    case "homegate_invalid_request":
    case "malformed_homegate_response":
      return "The invitation response could not be processed. Passport did not create a Pubky identity.";
    case "signup_failed":
      return preservedPassportFileMessage(hasCreationCleanupCandidate);
    case "signin_failed":
      return preservedPassportFileMessage(false);
    case "discovery_failed":
    case "local_save_failed":
      return preservedPassportFileMessage(hasCreationCleanupCandidate);
    default:
      return "The Pubky identity operation with Google failed.";
  }
}

function preservedPassportFileMessage(hasCreationCleanupCandidate: boolean): string {
  return "The encrypted Google Drive Passport file was preserved. Choose Add Pubky identity to retry activation."
    + (hasCreationCleanupCandidate ? " Development cleanup is available for the Passport file created by this failed setup." : "");
}
