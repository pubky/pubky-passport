"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type {
  BrowserAuthorizationController,
  BrowserAuthorizationViewState,
} from "../browser/authorization/browserAuthorizationController";
import { createBrowserAuthorizationController } from "../browser/authorization/createBrowserAuthorizationController";

type AuthorizationReviewProps = {
  relayOrigin: string;
  controllerFactory?: (input: { relayOrigin: string }) => BrowserAuthorizationController;
};

export function AuthorizationReview({
  relayOrigin,
  controllerFactory = createBrowserAuthorizationController,
}: AuthorizationReviewProps) {
  // The factory owns synchronous query scrubbing and StrictMode parser provenance.
  const [controller] = useState(() => controllerFactory({ relayOrigin }));
  const [state, setState] = useState<BrowserAuthorizationViewState>(() => controller.getState());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    controller.mounted();
    return unsubscribe;
  }, [controller]);

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
        <p className="text-sm text-neutral-600">Authorization request</p>
        <h1 className="text-2xl font-semibold">{state.review.requestingAppDisplayName ?? "An app"}</h1>
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
      <div aria-live="polite" className="flex gap-2">
        <button className="rounded border px-3 py-2" disabled={pending} onClick={() => void controller.approve()} type="button">
          {state.status === "approving" ? "Approving..." : "Approve"}
        </button>
        <button className="rounded border px-3 py-2" disabled={pending} onClick={() => controller.cancel()} type="button">Cancel</button>
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
