"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type {
  BrowserAuthorizationController,
  BrowserAuthorizationViewState,
} from "../browser/authorization/browserAuthorizationController";
import { createBrowserAuthorizationController } from "../browser/authorization/createBrowserAuthorizationController";
import type { createBrowserIdentityController } from "../browser/identity/createBrowserIdentityController";
import { AuthorizationIdentityPanel } from "./authorizationIdentityPanel";

type AuthorizationReviewProps = {
  googleClientId: string;
  homegateBaseUrl: string;
  controllerFactory?: () => BrowserAuthorizationController;
  identityControllerFactory?: typeof createBrowserIdentityController;
};

export function AuthorizationReview({
  googleClientId,
  homegateBaseUrl,
  controllerFactory = createBrowserAuthorizationController,
  identityControllerFactory,
}: AuthorizationReviewProps) {
  // The factory owns synchronous query scrubbing and StrictMode parser provenance.
  const [initial] = useState(() => {
    try {
      const controller = controllerFactory();
      return { controller, state: controller.getState() };
    } catch {
      return null;
    }
  });
  const controller = initial?.controller ?? null;
  const [state, setState] = useState<BrowserAuthorizationViewState | null>(initial?.state ?? null);
  const [identityReady, setIdentityReady] = useState(false);
  const [boundaryFailed, setBoundaryFailed] = useState(initial === null);

  useEffect(() => {
    if (!controller) return;

    let unsubscribe = () => {};
    try {
      unsubscribe = controller.subscribe(setState);
      controller.mounted();
    } catch {
      queueMicrotask(() => setBoundaryFailed(true));
    }

    return () => {
      try {
        unsubscribe();
      } catch { /* The browser controller owns cleanup logging. */ }
    };
  }, [controller]);

  async function approve(): Promise<void> {
    if (!controller) return;
    try {
      await controller.approve();
    } catch {
      setBoundaryFailed(true);
    }
  }

  function cancel(): void {
    if (!controller) return;
    try {
      controller.cancel();
    } catch {
      setBoundaryFailed(true);
    }
  }

  if (boundaryFailed || !state) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4 sm:p-8">
        <h1 className="text-2xl font-semibold">Authorization unavailable</h1>
        <p>Passport could not load the authorization review. Return to Passport and try again.</p>
        <Link className="w-fit underline" href="/">Back to Passport</Link>
      </main>
    );
  }

  if (state.status === "invalid") {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4 sm:p-8">
        <h1 className="text-2xl font-semibold">Invalid authorization request</h1>
        <p>The request cannot be safely authorized.</p>
        <Link className="w-fit underline" href="/">Back to Passport</Link>
      </main>
    );
  }

  if (state.status === "approved" || state.status === "cancelled" || state.status === "failed") {
    return (
      <main aria-live="polite" className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4 sm:p-8">
        <h1 className="text-2xl font-semibold">
          {state.status === "approved" ? "Authorization complete" : state.status === "cancelled" ? "Authorization cancelled" : "Authorization failed"}
        </h1>
        <p>
          {state.status === "approved"
            ? "The app was authorized. You can close this page."
            : state.status === "cancelled"
              ? "No authorization was granted."
              : authorizationFailureMessage(state.failureCode)}
        </p>
        <Link className="w-fit underline" href="/">Back to Passport</Link>
      </main>
    );
  }

  const pending = state.status !== "review";
  return (
    <main
      aria-busy={pending}
      className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-4 sm:p-8"
    >
      <header>
        <p className="text-sm text-neutral-600">Requesting app (unverified)</p>
        <h1 className="text-2xl font-semibold">{state.review.requestingAppDisplayName ?? "An app"}</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Encrypted handoff relay: <code>{state.review.relayHost}</code>
        </p>
      </header>
      <section className="flex flex-col gap-3 rounded border p-4">
        <h2 className="font-medium">Requested permissions</h2>
        {state.review.capabilities.map((capability, index) => (
          <div className="rounded border p-3" key={`${index}:${capability.path}`}>
            <code className="block max-w-full break-all whitespace-normal">{capability.path}</code>
            <p className="text-sm">{[capability.read ? "Read" : null, capability.write ? "Write" : null].filter(Boolean).join(" and ")}</p>
            {capability.scope === "broad" ? <p className="text-sm text-red-700">Broad access</p> : null}
          </div>
        ))}
      </section>
      <AuthorizationIdentityPanel
        disabled={pending}
        googleClientId={googleClientId}
        homegateBaseUrl={homegateBaseUrl}
        onReadyChange={setIdentityReady}
        {...(identityControllerFactory ? { controllerFactory: identityControllerFactory } : {})}
      />
      <div aria-live="polite" className="flex gap-2">
        <button className="rounded border px-3 py-2" disabled={pending || !identityReady} onClick={() => void approve()} type="button">
          {state.status === "approving" ? "Approving..." : "Approve"}
        </button>
        <button className="rounded border px-3 py-2" disabled={pending} onClick={cancel} type="button">Cancel</button>
      </div>
    </main>
  );
}

function authorizationFailureMessage(code: "no_active_identity" | "identity_restore_failed" | "approval_failed"): string {
  switch (code) {
    case "no_active_identity":
      return "Passport could not find an active identity. Set up or select an identity before trying again.";
    case "identity_restore_failed":
      return "Passport could not restore the active identity. Return to Passport and restore it before trying again.";
    default:
      return "Passport could not sign or deliver this authorization. Please try again.";
  }
}
