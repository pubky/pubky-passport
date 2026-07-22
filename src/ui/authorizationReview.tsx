"use client";

import { Result } from "better-result";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  getParserIssuedPubkyAuthCallbacks,
  parsePubkyAuthRequest,
  type PubkyAuthRequestReview,
  type ValidatedSensitivePubkyAuthRequest,
} from "../features/auth/parsePubkyAuthRequest";
import {
  approveActiveAuthorization,
  type ActiveAuthorizationErrorCode,
  type ActiveAuthorizationResult,
} from "../browser/authorization/approveActiveAuthorization";
import { LocalStorageIdentityRepository } from "../browser/identity/localIdentityRepository";
import { BrowserPubky, pubkyNetworkForTestnetHost } from "../browser/pubky/browserPubky";

type ParsedAuthorizationEntry =
  | { status: "valid"; review: PubkyAuthRequestReview; approval: ValidatedSensitivePubkyAuthRequest }
  | { status: "invalid" };

type SafeAuthorizationEntry =
  | { status: "valid"; review: PubkyAuthRequestReview }
  | { status: "invalid" };

type AuthorizationStatus = "review" | "approving" | "approved" | "cancelled" | "failed";

type PendingStrictModeEntry = { scrubbedHref: string; entry: ParsedAuthorizationEntry };

type AuthorizationReviewProps = {
  relayOrigin: string;
  allowLocalhostCallbacks: boolean;
  pubkyTestnetHost?: string | undefined;
  approveAuthorization?: (approval: ValidatedSensitivePubkyAuthRequest) => Promise<ActiveAuthorizationResult>;
  navigate?: (url: string) => void;
};

const pendingStrictModeEntries = new WeakMap<Window, PendingStrictModeEntry>();

export function AuthorizationReview({
  relayOrigin,
  allowLocalhostCallbacks,
  pubkyTestnetHost,
  approveAuthorization,
  navigate = replaceLocation,
}: AuthorizationReviewProps) {
  const approvalRef = useRef<ValidatedSensitivePubkyAuthRequest | null>(null);
  // Security initialization must scrub the query before commit; only safe review
  // data leaves this initializer while the sensitive approval stays in this ref.
  /* eslint-disable react-hooks/refs */
  const [entry] = useState<SafeAuthorizationEntry>(() => {
    const parsedEntry = readAndScrubAuthorizationEntry({ relayOrigin, allowLocalhostCallbacks });
    if (parsedEntry.status === "invalid") return parsedEntry;

    approvalRef.current = parsedEntry.approval;
    return { status: "valid", review: parsedEntry.review };
  });
  /* eslint-enable react-hooks/refs */
  const approvalPendingRef = useRef(false);
  const [status, setStatus] = useState<AuthorizationStatus>("review");
  const [failureCode, setFailureCode] = useState<ActiveAuthorizationErrorCode | null>(null);

  useEffect(() => {
    pendingStrictModeEntries.delete(window);
  }, []);

  if (entry.status === "invalid") {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4 sm:p-8">
        <h1 className="text-2xl font-semibold">Invalid authorization request</h1>
        <p>The request cannot be safely authorized.</p>
        <Link className="w-fit underline" href="/">Back to Passport</Link>
      </main>
    );
  }

  async function approve(): Promise<void> {
    const approval = approvalRef.current;
    if (!approval || approvalPendingRef.current || status !== "review") return;

    approvalPendingRef.current = true;
    setStatus("approving");
    let result: ActiveAuthorizationResult;
    try {
      result = await (approveAuthorization
        ? approveAuthorization(approval)
        : approveWithBrowserPubky(approval, pubkyTestnetHost));
    } catch {
      result = Result.err({ code: "approval_failed" });
    }
    if (Result.isOk(result)) {
      const success = getParserIssuedPubkyAuthCallbacks(approval)?.success;
      if (success && tryNavigate(navigate, success)) {
        return;
      }
      setStatus("approved");
      return;
    }

    setFailureCode(result.error.code);
    const errorCallback = getParserIssuedPubkyAuthCallbacks(approval)?.error;
    if (errorCallback && tryNavigate(navigate, errorCallback)) {
      return;
    }
    setStatus("failed");
  }

  function cancel(): void {
    const approval = approvalRef.current;
    if (!approval || approvalPendingRef.current || status !== "review") return;

    const cancelCallback = getParserIssuedPubkyAuthCallbacks(approval)?.cancel;
    if (cancelCallback && tryNavigate(navigate, cancelCallback)) {
      return;
    }
    setStatus("cancelled");
  }

  if (status === "approved" || status === "cancelled" || status === "failed") {
    return (
      <main aria-live="polite" className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4 sm:p-8">
        <h1 className="text-2xl font-semibold">
          {status === "approved" ? "Authorization complete" : status === "cancelled" ? "Authorization cancelled" : "Authorization failed"}
        </h1>
        <p>
          {status === "approved"
            ? "The app was authorized. You can close this page."
            : status === "cancelled"
              ? "No authorization was granted."
              : authorizationFailureMessage(failureCode)}
        </p>
        <Link className="w-fit underline" href="/">Back to Passport</Link>
      </main>
    );
  }

  return (
    <main
      aria-busy={status === "approving"}
      className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-4 sm:p-8"
    >
      <header>
        <p className="text-sm text-neutral-600">Authorization request</p>
        <h1 className="text-2xl font-semibold">{entry.review.requestingAppDisplayName ?? "An app"}</h1>
      </header>
      <section className="flex flex-col gap-3 rounded border p-4">
        <h2 className="font-medium">Requested permissions</h2>
        {entry.review.capabilities.map((capability, index) => (
          <div className="rounded border p-3" key={`${index}:${capability.path}`}>
            <code className="block max-w-full break-all whitespace-normal">{capability.path}</code>
            <p className="text-sm">{[capability.read ? "Read" : null, capability.write ? "Write" : null].filter(Boolean).join(" and ")}</p>
            {capability.scope === "broad" ? <p className="text-sm text-red-700">Broad access</p> : null}
          </div>
        ))}
      </section>
      <div aria-live="polite" className="flex gap-2">
        <button className="rounded border px-3 py-2" disabled={status !== "review"} onClick={() => void approve()} type="button">
          {status === "approving" ? "Approving..." : "Approve"}
        </button>
        <button className="rounded border px-3 py-2" disabled={status !== "review"} onClick={cancel} type="button">Cancel</button>
      </div>
    </main>
  );
}

function readAndScrubAuthorizationEntry(options: {
  relayOrigin: string;
  allowLocalhostCallbacks: boolean;
}): ParsedAuthorizationEntry {
  const browserWindow = window;
  const rawSearch = browserWindow.location.search;
  const scrubbedHref = `${browserWindow.location.origin}${browserWindow.location.pathname}${browserWindow.location.hash}`;
  browserWindow.history.replaceState(null, "", `${browserWindow.location.pathname}${browserWindow.location.hash}`);

  if (rawSearch.length === 0) {
    const pending = pendingStrictModeEntries.get(browserWindow);
    if (pending?.scrubbedHref === scrubbedHref) {
      pendingStrictModeEntries.delete(browserWindow);
      return pending.entry;
    }
  }

  const rawD = extractRawDQueryValue(rawSearch);
  const parsed = parsePubkyAuthRequest(
    rawD.valid ? rawD.value : undefined,
    {
      allowedRelayOrigins: [options.relayOrigin],
      allowLocalhostCallbacks: options.allowLocalhostCallbacks,
    },
  );
  const entry: ParsedAuthorizationEntry = Result.isError(parsed)
    ? { status: "invalid" }
    : { status: "valid", review: parsed.value.review, approval: parsed.value.approval };
  const pending = { scrubbedHref, entry };
  pendingStrictModeEntries.set(browserWindow, pending);
  queueMicrotask(() => {
    if (pendingStrictModeEntries.get(browserWindow) === pending) {
      pendingStrictModeEntries.delete(browserWindow);
    }
  });
  return entry;
}

function extractRawDQueryValue(search: string): { valid: true; value?: string } | { valid: false } {
  let value: string | undefined;

  for (const parameter of search.slice(1).split("&")) {
    const separator = parameter.indexOf("=");
    const name = separator === -1 ? parameter : parameter.slice(0, separator);
    if (name !== "d") continue;
    if (separator === -1 || value !== undefined) return { valid: false };
    value = parameter.slice(separator + 1);
  }

  return value === undefined ? { valid: true } : { valid: true, value };
}

function tryNavigate(navigate: (url: string) => void, url: string): boolean {
  try {
    navigate(url);
    return true;
  } catch {
    return false;
  }
}

function authorizationFailureMessage(code: ActiveAuthorizationErrorCode | null): string {
  switch (code) {
    case "no_active_identity":
      return "Passport could not find an active identity. Set up or select an identity before trying again.";
    case "identity_restore_failed":
      return "Passport could not restore the active identity. Return to Passport and restore it before trying again.";
    default:
      return "Passport could not sign or deliver this authorization. Please try again.";
  }
}

async function approveWithBrowserPubky(
  approval: ValidatedSensitivePubkyAuthRequest,
  pubkyTestnetHost?: string,
): Promise<ActiveAuthorizationResult> {
  let pubky: BrowserPubky;
  try {
    pubky = new BrowserPubky({
      network: pubkyNetworkForTestnetHost(pubkyTestnetHost),
    });
  } catch {
    return Result.err({ code: "approval_failed" });
  }

  try {
    const result = await approveActiveAuthorization({
      authRequest: approval,
      localIdentities: new LocalStorageIdentityRepository(),
      pubky,
    });
    return result;
  } finally {
    try {
      pubky.dispose();
    } catch {
      // Per-key cleanup was already attempted by the authorization use case.
    }
  }
}

function replaceLocation(url: string): void {
  window.location.replace(url);
}
