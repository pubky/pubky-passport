import { Result } from "better-result";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { LocalIdentityHomeserverRepublishResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { PubkyHomeserverResolutionResult } from "@/client/logic/pubky/pubkyIdentityKey";
import { ProviderTerms, usePassportProvider } from "@/client/ui/passportProviderConfiguration";
import { DetailField } from "@/client/ui/shared/detailField";
import { RotateCcwIcon, TriangleAlertIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { Button, ButtonLink } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Spinner } from "@/client/ui/shared/primitives/spinner";

/** A failed lookup is not evidence that the record is missing, so the two stay distinct. */
type HomeserverLookup =
  | { status: "looking-up" }
  | { status: "not-found" }
  | { status: "lookup-failed" }
  | { status: "resolved"; pubky: string };

const REPUBLISH_FAILED = "Could not republish the homeserver record. Please try again.";

/**
 * The identity's homeserver as its `_pubky` record resolves, with repair for a missing record.
 * Repair is offered only when the lookup definitively found no record, and only after the user
 * confirms the exact homeserver the record will point at: the one the key was signed up on, or,
 * for an identity that does not remember it, the provider's.
 */
export function HomeserverRecord({
  publicKeyZ32,
  registeredHomeserver,
  providerHomeserver,
  republishHomeserver,
  resolveHomeserver,
}: {
  publicKeyZ32: string;
  /** Homeserver this browser signed the key up on; when known, the only repair target. */
  registeredHomeserver?: string | undefined;
  /** Repair target for identities that do not remember theirs; repair is hidden without one. */
  providerHomeserver?: string | undefined;
  /** Omitted for keys Passport cannot sign with, such as identities held in Pubky Ring. */
  republishHomeserver?: (
    publicKeyZ32: string,
    homeserverPubky: string,
  ) => Promise<LocalIdentityHomeserverRepublishResult>;
  resolveHomeserver: (publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult>;
}) {
  const provider = usePassportProvider();
  const [lookup, setLookup] = useState<HomeserverLookup>({ status: "looking-up" });
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [republishing, setRepublishing] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const homeserverField = useRef<HTMLDivElement>(null);
  const recordAction = useRef<HTMLButtonElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  // Opening, closing and retrying unmount the focused control, so each names where focus goes.
  const pendingFocus = useRef<"confirmation" | "record" | null>(null);

  // A layout effect moves focus in the same commit that removes the focused control.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target === "confirmation") confirmationHeading.current?.focus();
    else (recordAction.current ?? homeserverField.current)?.focus();
  });

  useEffect(() => {
    let cancelled = false;
    void resolveHomeserver(publicKeyZ32).then(
      (result) => {
        if (!cancelled) setLookup(lookupFrom(result));
      },
      (e: unknown) => {
        LOGGER.warn("identity.management.failed", {
          operation: "resolve_homeserver",
          ...safeErrorLogFields(e),
        });
        if (!cancelled) setLookup({ status: "lookup-failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [publicKeyZ32, resolveHomeserver, lookupAttempt]);

  function openConfirmation(): void {
    pendingFocus.current = "confirmation";
    setConfirming(true);
  }

  function closeConfirmation(): void {
    pendingFocus.current = "record";
    setConfirming(false);
  }

  function retryLookup(): void {
    pendingFocus.current = "record";
    setMessage(null);
    setLookup({ status: "looking-up" });
    setLookupAttempt((attempt) => attempt + 1);
  }

  async function republish(homeserverPubky: string): Promise<void> {
    if (!republishHomeserver) return;
    setRepublishing(true);
    setMessage(null);
    try {
      const republished = await republishHomeserver(publicKeyZ32, homeserverPubky);
      closeConfirmation();
      if (Result.isOk(republished)) {
        setLookup({ status: "resolved", pubky: republished.value });
        setMessage({ error: false, text: "Homeserver record republished." });
        return;
      }
      switch (republished.error.code) {
        case "resolution_failed":
          setLookup({ status: "lookup-failed" });
          setMessage({
            error: true,
            text: "Could not check the current record, so nothing was published.",
          });
          return;
        case "still_unresolved":
          setMessage({
            error: true,
            text: "The record was published but still does not resolve. Wait a moment and try again.",
          });
          return;
        case "homeserver_mismatch":
        case "identity_unavailable":
        case "publication_failed":
          setMessage({ error: true, text: REPUBLISH_FAILED });
          return;
      }
    } catch (e) {
      LOGGER.warn("identity.management.failed", {
        operation: "republish_homeserver",
        ...safeErrorLogFields(e),
      });
      closeConfirmation();
      setMessage({ error: true, text: REPUBLISH_FAILED });
    } finally {
      setRepublishing(false);
    }
  }

  // Only the homeserver the key was signed up on is known to hold the account. Identities from
  // imports and older builds do not remember it and fall back to the provider's, if confirmed.
  const repairTarget = republishHomeserver
    ? (registeredHomeserver ?? providerHomeserver)
    : undefined;

  return (
    <>
      <div
        ref={homeserverField}
        aria-label="Homeserver"
        className="w-full min-w-0 outline-none"
        role="group"
        tabIndex={-1}
      >
        <DetailField
          copy={{
            value: lookup.status === "resolved" ? lookup.pubky : null,
            copied: "Homeserver copied",
            failed: "Could not copy homeserver",
            failedDescription: "Select and copy the homeserver manually.",
          }}
          label="Homeserver"
          value={homeserverStatus(lookup)}
        />
      </div>
      {message?.error ? <Notice tone="error">{message.text}</Notice> : null}
      {message && !message.error ? <FieldMessage role="status">{message.text}</FieldMessage> : null}
      {lookup.status === "lookup-failed" ? (
        <>
          <p className="text-sm leading-5 text-secondary-foreground">
            Passport could not look up this pubky&apos;s homeserver record. Check your connection
            and try again.
          </p>
          <Button ref={recordAction} onClick={retryLookup} variant="secondary">
            <RotateCcwIcon /> Retry lookup
          </Button>
        </>
      ) : null}
      {lookup.status === "not-found" && !repairTarget ? (
        // Every missing record says what it means, even where Passport cannot repair it.
        <p className="text-sm leading-5 text-secondary-foreground">
          {republishHomeserver
            ? "No homeserver record was found for this pubky, so apps cannot find your profile. Passport doesn’t know which homeserver it was created on, so repair it from the app you created it with."
            : "No homeserver record was found for this pubky, so apps cannot find your profile. Its key stays in Pubky Ring, so only Pubky Ring can publish the record again."}
        </p>
      ) : null}
      {lookup.status === "not-found" && repairTarget ? (
        confirming ? (
          <section
            aria-labelledby="republish-homeserver-confirmation"
            className="flex w-full min-w-0 flex-col gap-4 rounded-lg border border-border p-4"
          >
            <h3
              ref={confirmationHeading}
              id="republish-homeserver-confirmation"
              className="font-bold outline-none"
              tabIndex={-1}
            >
              {registeredHomeserver
                ? "Point this pubky back at its homeserver?"
                : "Was this pubky created on this Passport’s homeserver?"}
            </h3>
            <DetailField label="Homeserver to publish" value={repairTarget} />
            {registeredHomeserver ? (
              <p className="text-sm leading-5 text-secondary-foreground">
                Your account was created on this homeserver from this browser.
              </p>
            ) : (
              // Nothing here remembers where this pubky was created, so the person decides, and
              // not being sure means No: a wrong record hides the profile.
              <Notice tone="warning">
                Choose Yes only if you signed up here without entering a different homeserver. If
                you’re not sure, cancel: pointing it to the wrong homeserver hides your profile from
                apps.
              </Notice>
            )}
            <div className="flex flex-wrap gap-3">
              <Button disabled={republishing} onClick={closeConfirmation} variant="outline">
                Cancel
              </Button>
              <Button loading={republishing} onClick={() => void republish(repairTarget)}>
                <RotateCcwIcon />{" "}
                {republishing
                  ? "Republishing…"
                  : registeredHomeserver
                    ? "Publish record"
                    : "Yes, publish record"}
              </Button>
            </div>
          </section>
        ) : (
          <>
            <p className="text-sm leading-5 text-secondary-foreground">
              No homeserver record was found for this pubky, so apps cannot find your profile.
            </p>
            <Button ref={recordAction} onClick={openConfirmation} variant="secondary">
              <RotateCcwIcon /> Republish homeserver
            </Button>
          </>
        )
      ) : null}
      {lookup.status === "resolved" && lookup.pubky === providerHomeserver ? (
        <>
          {provider.storageDescription ? (
            <p className="text-sm text-secondary-foreground">{provider.storageDescription}</p>
          ) : null}
          {provider.upgradeUrl ? (
            <ButtonLink
              href={provider.upgradeUrl}
              target="_blank"
              rel="noreferrer"
              variant="secondary"
            >
              Manage storage
            </ButtonLink>
          ) : null}
          <ProviderTerms />
        </>
      ) : null}
    </>
  );
}

function lookupFrom(result: PubkyHomeserverResolutionResult): HomeserverLookup {
  if (Result.isError(result)) return { status: "lookup-failed" };
  return result.value === null
    ? { status: "not-found" }
    : { status: "resolved", pubky: result.value };
}

/** The field's value: the homeserver, or a status that does not look like one. */
function homeserverStatus(lookup: HomeserverLookup): ReactNode {
  switch (lookup.status) {
    case "looking-up":
      return (
        <span className="inline-flex items-center gap-2 font-normal text-muted-foreground">
          <Spinner className="size-4" decorative />
          Looking up…
        </span>
      );
    case "not-found":
      return (
        <span className="inline-flex items-center gap-2">
          <TriangleAlertIcon className="text-warning" />
          No record found
        </span>
      );
    case "lookup-failed":
      return <span className="font-normal text-muted-foreground">Couldn’t check</span>;
    case "resolved":
      return lookup.pubky;
  }
}
