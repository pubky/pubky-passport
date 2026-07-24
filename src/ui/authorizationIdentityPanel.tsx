"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import type {
  BrowserIdentityActionResult,
  BrowserIdentityController,
} from "../browser/identity/browserIdentityController";
import { createBrowserIdentityController } from "../browser/identity/createBrowserIdentityController";
import type { LocalIdentitySummary } from "../features/identity/localIdentity";
import { logger } from "../libs/logger/logger";
import { GoogleSignInButton } from "./googleSignInButton";

export function AuthorizationIdentityPanel({
  googleClientId,
  homegateBaseUrl,
  passportUrl,
  disabled,
  onReadyChange,
  controllerFactory = createBrowserIdentityController,
}: {
  googleClientId: string;
  homegateBaseUrl: string;
  passportUrl: string;
  disabled: boolean;
  onReadyChange: (ready: boolean) => void;
  controllerFactory?: typeof createBrowserIdentityController;
}) {
  const controller = useRef<BrowserIdentityController | null>(null);
  const readyCallback = useRef(onReadyChange);
  const [identities, setIdentities] = useState<LocalIdentitySummary[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const [addingIdentity, setAddingIdentity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading identities...");

  useEffect(() => {
    readyCallback.current = onReadyChange;
  }, [onReadyChange]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        controller.current = controllerFactory({ googleClientId, homegateBaseUrl, passportUrl });
        refreshIdentities();
      } catch {
        logger.warn("authorize.identity.initialize.failed");
        setMessage("Passport could not load identities in this browser.");
        readyCallback.current(false);
      }
    });
    return () => {
      cancelled = true;
      controller.current?.dispose();
      controller.current = null;
    };
  }, [controllerFactory, googleClientId, homegateBaseUrl, passportUrl]);

  function refreshIdentities(nextMessage?: string): void {
    const stored = controller.current?.list();
    if (!stored || Result.isError(stored)) {
      setIdentities([]);
      setSelectedIdentityId("");
      setMessage("Passport could not read local identities.");
      readyCallback.current(false);
      return;
    }

    setIdentities(stored.value.identities);
    setSelectedIdentityId(stored.value.activeIdentityId ?? "");
    readyCallback.current(stored.value.activeIdentityId !== null);
    setMessage(nextMessage ?? (stored.value.activeIdentityId ? "Identity ready." : "Choose or add an identity to continue."));
  }

  function selectIdentity(id: string): void {
    const selected = controller.current?.select(id);
    if (!selected || Result.isError(selected)) {
      setMessage("Passport could not select that identity.");
      return;
    }

    setSelectedIdentityId(id);
    setMessage("Identity ready.");
    readyCallback.current(true);
  }

  function completeGoogleAction(result: BrowserIdentityActionResult): void {
    setBusy(false);
    setAddingIdentity(false);
    if (Result.isError(result)) {
      logger.warn("authorize.identity.google.failed", { code: result.error.code });
      refreshIdentities(messageForGoogleFailure(result.error.code));
      return;
    }

    refreshIdentities(result.value.kind === "established" && result.value.source === "created"
      ? "Identity created and ready."
      : "Identity restored and ready.");
  }

  function cancelGoogleAction(): void {
    controller.current?.unmountGoogleSignIn();
    setBusy(false);
    setAddingIdentity(false);
    refreshIdentities("Google identity setup cancelled.");
  }

  function beginGoogleAction(): void {
    readyCallback.current(false);
    setAddingIdentity(true);
  }

  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <h2 className="font-medium">Authorize as</h2>
      <select
        aria-label="Authorization identity"
        autoComplete="off"
        disabled={disabled || busy || addingIdentity || identities.length === 0}
        onChange={(event) => selectIdentity(event.target.value)}
        value={selectedIdentityId}
      >
        {selectedIdentityId === "" ? (
          <option value="">{identities.length === 0 ? "No local identity" : "Choose an identity"}</option>
        ) : null}
        {identities.map((identity) => (
          <option key={identity.id} value={identity.id}>{identity.publicIdentity.publicKeyDisplay}</option>
        ))}
      </select>

      {addingIdentity && controller.current ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm">Sign in with Google to create or restore your Pubky identity.</p>
          <GoogleSignInButton
            action={{ kind: "establish" }}
            controller={controller.current}
            disabled={disabled || busy}
            onActionCompleted={completeGoogleAction}
            onBusyChange={setBusy}
          />
          <button className="rounded border px-3 py-2" disabled={disabled || busy} onClick={cancelGoogleAction} type="button">Cancel sign-in</button>
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
    case "homegate_invite_failed":
    case "signup_failed":
    case "signin_failed":
    case "discovery_failed":
    case "local_save_failed":
      return "Identity setup did not finish and may require recovery before authorization." + ` (Error code: ${code})`;
    default:
      return "Passport could not create or restore the Google identity. Try again.";
  }
}
