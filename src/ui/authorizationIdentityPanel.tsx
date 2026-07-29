"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import type {
  BrowserIdentityController,
  GoogleBackedIdentityActionResult,
  LocalIdentitySummary,
} from "../browser/identity/browserIdentityController";
import { createBrowserIdentityController } from "../browser/identity/createBrowserIdentityController";
import { LOGGER } from "../libs/logger/logger";
import { GoogleBackedIdentityActionPanel } from "./googleBackedIdentityActionPanel";

export function AuthorizationIdentityPanel({
  googleClientId,
  homegateBaseUrl,
  disabled,
  onReadyChange,
  controllerFactory = createBrowserIdentityController,
}: {
  googleClientId: string;
  homegateBaseUrl: string;
  disabled: boolean;
  onReadyChange: (ready: boolean) => void;
  controllerFactory?: typeof createBrowserIdentityController;
}) {
  const controller = useRef<BrowserIdentityController | null>(null);
  const readyCallback = useRef(onReadyChange);
  const identityActionPending = useRef(false);
  const [identities, setIdentities] = useState<LocalIdentitySummary[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const [establishingIdentity, setEstablishingIdentity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading Pubky identities...");

  useEffect(() => {
    readyCallback.current = onReadyChange;
  }, [onReadyChange]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        controller.current = controllerFactory({ googleClientId, homegateBaseUrl });
        unsubscribe = controller.current.subscribe(() => {
          if (!identityActionPending.current) refreshIdentities();
        });
        refreshIdentities();
      } catch {
        LOGGER.warn("authorize.identity.initialize.failed");
        setMessage("Passport could not load Pubky identities in this browser.");
        readyCallback.current(false);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
      controller.current?.dispose();
      controller.current = null;
    };
  }, [controllerFactory, googleClientId, homegateBaseUrl]);

  function refreshIdentities(nextMessage?: string): void {
    const stored = controller.current?.list();
    if (!stored || Result.isError(stored)) {
      setIdentities([]);
      setSelectedIdentityId("");
      setMessage("Passport could not read local Pubky identities.");
      readyCallback.current(false);
      return;
    }

    setIdentities(stored.value.identities);
    setSelectedIdentityId(stored.value.activeIdentityId ?? "");
    readyCallback.current(stored.value.activeIdentityId !== null);
    setMessage(nextMessage ?? (stored.value.activeIdentityId ? "Pubky identity ready." : "Choose or add a Pubky identity to continue."));
  }

  function selectIdentity(id: string): void {
    const selected = controller.current?.select(id);
    if (!selected || Result.isError(selected)) {
      setMessage("Passport could not select that Pubky identity.");
      return;
    }

    setSelectedIdentityId(id);
    setMessage("Pubky identity ready.");
    readyCallback.current(true);
  }

  function completeGoogleAction(result: GoogleBackedIdentityActionResult): void {
    identityActionPending.current = false;
    setBusy(false);
    setEstablishingIdentity(false);
    if (Result.isError(result)) {
      LOGGER.warn("authorize.identity.google.failed", { code: result.error.code });
      refreshIdentities(messageForGoogleFailure(result.error.code));
      return;
    }

    refreshIdentities(result.value.kind === "google_backed_identity_established" && result.value.establishmentMode === "created"
      ? "Pubky identity created and ready."
      : "Pubky identity restored and ready.");
  }

  function cancelGoogleAction(): void {
    controller.current?.unmountGoogleSignIn();
    identityActionPending.current = false;
    setBusy(false);
    setEstablishingIdentity(false);
    refreshIdentities("Pubky identity setup with Google cancelled.");
  }

  function beginGoogleAction(): void {
    identityActionPending.current = true;
    readyCallback.current(false);
    setEstablishingIdentity(true);
  }

  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <h2 className="font-medium">Authorize as</h2>
      <select
        aria-label="Authorization Pubky identity"
        autoComplete="off"
        className="w-full min-w-0 max-w-full"
        disabled={disabled || busy || establishingIdentity || identities.length === 0}
        onChange={(event) => selectIdentity(event.target.value)}
        value={selectedIdentityId}
      >
        {selectedIdentityId === "" ? (
          <option value="">{identities.length === 0 ? "No local Pubky identity" : "Choose a Pubky identity"}</option>
        ) : null}
        {identities.map((identity) => (
          <option key={identity.id} value={identity.id}>{identity.publicIdentity.publicKeyDisplay}</option>
        ))}
      </select>

      {establishingIdentity && controller.current ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm">Sign in with Google to create or restore your Pubky identity.</p>
          <GoogleBackedIdentityActionPanel
            action={{ kind: "establish_google_backed_identity" }}
            controller={controller.current}
            disabled={disabled || busy}
            onActionCompleted={completeGoogleAction}
            onBusyChange={setBusy}
          />
          <button className="rounded border px-3 py-2" disabled={disabled || busy} onClick={cancelGoogleAction} type="button">Cancel identity setup</button>
        </div>
      ) : (
        <button
          className="w-fit rounded border px-3 py-2"
          disabled={disabled || busy || controller.current === null}
          onClick={beginGoogleAction}
          type="button"
        >
          Add or restore with Google
        </button>
      )}
      <p aria-live="polite" className="text-sm text-neutral-600">{message}</p>
    </section>
  );
}

function messageForGoogleFailure(code: string): string {
  switch (code) {
    case "invalid_google_id_token":
      return "Your Google session is no longer valid. Sign in again to continue.";
    case "weekly_limit_exceeded":
      return "This Google account has reached its weekly homeserver signup limit.";
    case "annual_limit_exceeded":
      return "This Google account has reached its annual homeserver signup limit.";
    case "homeserver_unavailable":
      return "The homeserver is temporarily unavailable. Try again later.";
    case "google_verifier_unavailable":
    case "homegate_unavailable":
    case "network_failed":
      return "The homeserver invitation service is temporarily unavailable. Try again later.";
    case "homegate_invalid_request":
    case "malformed_homegate_response":
      return "Passport could not process the homeserver invitation response. Try again later.";
    case "signup_failed":
    case "signin_failed":
    case "discovery_failed":
    case "local_save_failed":
      return "The encrypted Google Drive Passport file was preserved. Choose Add or restore with Google to retry Pubky identity activation.";
    default:
      return "Passport could not create or restore the Pubky identity with your Google account. Try again.";
  }
}
