"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import type {
  BrowserIdentityActionResult,
  BrowserIdentityController,
  LocalIdentitySummary,
} from "../browser/identity/browserIdentityController";
import { createBrowserIdentityController } from "../browser/identity/createBrowserIdentityController";
import type { PubkyPublicIdentity } from "../core/identity/pubkyIdentity";
import { logger } from "../libs/logger/logger";
import { GoogleSignInButton } from "./googleSignInButton";

type GoogleAction = "add" | "delete-selected" | "delete-failed" | null;

export function DevelopmentIdentityPanel({
  googleClientId,
  homegateBaseUrl,
  allowGoogleDriveReset,
}: {
  googleClientId: string;
  homegateBaseUrl: string;
  allowGoogleDriveReset: boolean;
}) {
  const controller = useRef<BrowserIdentityController | null>(null);
  const [controllerReady, setControllerReady] = useState(false);
  const [identities, setIdentities] = useState<LocalIdentitySummary[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const [googleAction, setGoogleAction] = useState<GoogleAction>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ready.");
  const [recoverableDriveIdentity, setRecoverableDriveIdentity] = useState<PubkyPublicIdentity | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        controller.current = createBrowserIdentityController({ googleClientId, homegateBaseUrl });
        setControllerReady(true);
        refreshIdentities();
      } catch {
        logger.warn("identity.pubky.initialize.failed");
        setMessage("Could not initialize Pubky in this browser.");
      }
    });
    return () => {
      cancelled = true;
      controller.current?.dispose();
      controller.current = null;
    };
  }, [googleClientId, homegateBaseUrl]);

  function refreshIdentities(nextMessage?: string): void {
    const stored = controller.current?.list();
    if (!stored || Result.isError(stored)) {
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
    const selected = controller.current?.select(id);
    if (!selected || Result.isError(selected)) {
      setMessage("Could not select that identity.");
      return;
    }

    setSelectedIdentityId(id);
    setMessage("Identity selected.");
  }

  function completeGoogleAction(result: BrowserIdentityActionResult): void {
    if (Result.isError(result)) {
      logger.warn("identity.google.action.failed", { code: result.error.code });
      setRecoverableDriveIdentity(result.error.recoverablePublicIdentity ?? null);
      setMessage(messageForGoogleFailure(result.error.code));
    } else if (result.value.kind === "established") {
      setRecoverableDriveIdentity(null);
      refreshIdentities(result.value.source === "created" ? "Identity created." : "Identity restored.");
    } else {
      if (googleAction === "delete-failed") setRecoverableDriveIdentity(null);
      setMessage("Identity deleted from Google Drive.");
    }
    setBusy(false);
    setGoogleAction(null);
  }

  function clearLocalIdentities(): void {
    const cleared = controller.current?.clear();
    if (!cleared || Result.isError(cleared)) {
      setMessage("Could not clear local identities.");
      return;
    }

    refreshIdentities("Local identities cleared.");
  }

  const selectedIdentity = identities.find((identity) => identity.id === selectedIdentityId);

  function beginGoogleAction(action: Exclude<GoogleAction, null>): void {
    setGoogleAction(action);
  }

  function cancelGoogleAction(): void {
    controller.current?.unmountGoogleSignIn();
    setBusy(false);
    setGoogleAction(null);
  }

  const googleIdentityAction = googleAction === "add"
    ? { kind: "establish" } as const
    : googleAction === "delete-selected" && selectedIdentity
      ? { kind: "delete", expectedPublicKeyZ32: selectedIdentity.publicIdentity.publicKeyZ32 } as const
      : googleAction === "delete-failed" && recoverableDriveIdentity
        ? { kind: "delete", expectedPublicKeyZ32: recoverableDriveIdentity.publicKeyZ32 } as const
        : null;

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
          <button className="rounded border px-3 py-2" disabled={busy || !controllerReady} onClick={() => beginGoogleAction("add")} type="button">Add identity</button>
          {allowGoogleDriveReset && selectedIdentity ? (
            <button
              className="rounded border border-red-700 px-3 py-2 text-red-700"
              disabled={busy}
              onClick={() => {
                if (globalThis.confirm("Authorize Google again, verify the selected identity, and delete its Passport Drive file?")) beginGoogleAction("delete-selected");
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
                if (globalThis.confirm("Authorize Google again, verify the identity that could not be activated, and delete its Passport Drive file?")) beginGoogleAction("delete-failed");
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
                if (globalThis.confirm("Clear all Passport identities stored in this browser? Google Drive data will not be changed.")) clearLocalIdentities();
              }}
              type="button"
            >
              Clear local identities
            </button>
          ) : null}
        </div>
      ) : googleIdentityAction && controller.current ? (
        <div className="flex flex-col items-start gap-3 rounded border p-3">
          <p>{googleAction === "add"
            ? "Authorize Google to create or restore an identity."
            : googleAction === "delete-selected"
              ? "Authorize Google again to delete the selected identity."
              : "Authorize Google again to delete the identity that could not be activated."}</p>
          <GoogleSignInButton
            action={googleIdentityAction}
            controller={controller.current}
            disabled={busy}
            onActionCompleted={completeGoogleAction}
            onBusyChange={setBusy}
          />
          <button className="rounded border px-3 py-2" disabled={busy} onClick={cancelGoogleAction} type="button">Cancel</button>
        </div>
      ) : null}

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
      return "Passport could not obtain a homeserver invitation and did not create an identity. Try again later.";
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
