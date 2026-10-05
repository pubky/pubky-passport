"use client";

import { Result } from "better-result";
import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { RingVerificationErrorCode } from "@/client/logic/backup/RingBackupVerifier";
import { ringVerification } from "@/client/logic/local-identity/keyBackup";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { BackupStatusLine, formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import type { RingBackupVerifierPort } from "@/client/ui/passportCollaborators";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { CancelButton } from "@/client/ui/shared/cancelButton";
import { shortPublicKey } from "@/client/ui/shared/formatPublicKey";
import { identityDisplayName, profileName } from "@/client/ui/shared/identityDisplay";
import { Button } from "@/client/ui/shared/primitives/button";
import { RING_ILLUSTRATION } from "@/client/ui/shared/ringHandoffCard";
import { RingHandoffScreen } from "@/client/ui/shared/ringHandoffScreen";
import { useDeepLinkLauncher, useKnownRingHandoffMode } from "@/client/ui/shared/useRingHandoff";
import { ExternalSignerRequest } from "@/client/ui/universal-signer/externalSignerRequest";
import { ChoiceCard } from "@/client/ui/shared/choiceCard";

type CheckState =
  | { status: "starting" | "waiting" }
  | { status: "verified"; at: Date }
  | { status: "failed"; failure: RingVerificationErrorCode };

const POLL_INTERVAL_MS = 1_500;
/** A failure stays until read or closed: it says what to do before pressing the spent code. */
const FAILURE_TOAST_MS = 10_000;

/** What went wrong; nothing was recorded in any case. `expected` names the pubky to choose. */
function verificationError(code: RingVerificationErrorCode, expected: string): string {
  switch (code) {
    case "cancelled":
      return "This verification request was closed. Start a new one.";
    case "connection_failed":
      return "The check failed, either at the relay while waiting for Pubky Ring or at your homeserver after Pubky Ring approved. Try again and approve the new request in Pubky Ring.";
    case "expired":
      return "This verification request expired. Start a new one.";
    case "grant_rejected":
      return "Pubky Ring approved, but your homeserver did not accept the sign-in. Try again and approve the new request in Pubky Ring.";
    case "homeserver_unresolved":
      return "Pubky Ring approved, but Passport could not find your pubky's homeserver. Try again later.";
    case "request_failed":
      return "Passport could not create a verification request. Please try again.";
    case "storage_failed":
      return "Pubky Ring approved with this pubky, but Passport could not save the check in this browser. Free some storage and try again.";
    case "wrong_identity":
      return `Pubky Ring approved with a different pubky. In Pubky Ring, choose ${expected}, then try again.`;
  }
}

/**
 * The Pubky Ring half of Verify your backup: proves Pubky Ring holds this browser key, as opening a
 * recovery file proves the file. Ring approves a sign-in that grants nothing; only an approval
 * signed with this identity's key counts, and its Session is signed out at once (the verifier
 * records the date). As on the start page, a computer shows the code as soon as the page is up,
 * with nothing to press; a phone starts from the card's button, follows the link from that press,
 * keeps one button to follow it again (never a code), and can Cancel. Success is said here, in the
 * card; a failure in a toast, while a computer's code turns into its blurred "Click to reload"
 * tile and a phone offers Try again. The recovery-file card beside it is not touched.
 */
export function RingBackupCheck({
  identity,
  onVerified,
  verifier,
}: {
  identity: LocalIdentityMetadata;
  /** Told when Pubky Ring signed with this key. */
  onVerified?: ((at: Date) => void) | undefined;
  verifier: RingBackupVerifierPort;
}) {
  const publicKey = identity.publicIdentity.publicKeyZ32;
  const lastVerified = ringVerification(identity);
  const expected = profileName(identity)
    ? `${identityDisplayName(identity)} (${shortPublicKey(publicKey)})`
    : `the pubky ${shortPublicKey(publicKey)}`;
  // Until the browser says which it is, the card shows the phone's button.
  const mode = useKnownRingHandoffMode();
  const [, launcher] = useDeepLinkLauncher();
  // "closed" is the card after a phone's check was cancelled, as opposed to never started.
  const [opened, setOpened] = useState<"idle" | "open" | "closed">("idle");
  const running = mode === "scan" || opened === "open";
  // Only a computer shows a code; a phone opens Pubky Ring, whatever became of a launch.
  const scanning = mode === "scan";
  const [state, setState] = useState<CheckState>({ status: "starting" });
  const [attempt, setAttempt] = useState(0);
  const verified = useEffectEvent((at: Date) => onVerified?.(at));
  const region = useRef<HTMLDivElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const handoff = useRef<HTMLDivElement>(null);
  const passed = useRef<HTMLParagraphElement>(null);
  const id = useId();

  // Opening, closing, retrying and passing each remove the control that was pressed, so focus
  // follows to what replaced it; nothing takes focus when the page first renders.
  useLayoutEffect(() => {
    if (opened === "open" && state.status === "starting")
      region.current?.focus({ preventScroll: true });
    else if (opened === "closed") start.current?.focus();
  }, [opened, state.status]);
  useLayoutEffect(() => {
    if (attempt > 0 && state.status === "waiting") handoff.current?.focus({ preventScroll: true });
    if (state.status === "verified" && (attempt > 0 || opened === "open")) passed.current?.focus();
  }, [attempt, opened, state.status]);

  useEffect(() => {
    if (!running) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const result = await verifier.poll();
      if (!active) return;
      if (Result.isError(result)) {
        setState({ status: "failed", failure: result.error.code });
        return;
      }
      if (result.value.status === "verified") {
        setState({ status: "verified", at: result.value.at });
        verified(result.value.at);
        return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }
    void verifier.start(publicKey).then((result) => {
      if (!active) return;
      if (Result.isError(result)) {
        setState({ status: "failed", failure: result.error.code });
        return;
      }
      setState({ status: "waiting" });
      void poll();
    });
    return () => {
      active = false;
      clearTimeout(timer);
      verifier.dispose();
    };
  }, [verifier, publicKey, attempt, running]);

  // A failure is said in a toast, not in a box under the code. One per attempt and failure.
  const failure =
    state.status === "failed"
      ? `${verificationError(state.failure, expected)} Nothing was recorded.`
      : undefined;
  useEffect(() => {
    if (failure)
      toast.error(failure, {
        closeButton: true,
        duration: FAILURE_TOAST_MS,
        id: `${id}-failure-${attempt}`,
      });
  }, [attempt, failure, id]);

  function retry() {
    // A new request gets its own link, which may open Pubky Ring this time.
    launcher?.reset();
    setState({ status: "starting" });
    setAttempt((current) => current + 1);
  }

  function open() {
    launcher?.reset();
    setState({ status: "starting" });
    setOpened("open");
  }

  const phone = "your phone";

  return (
    <ChoiceCard
      dense
      description={
        lastVerified ? `Last verified ${formatBackupDate(lastVerified)}` : "Never verified"
      }
      illustration={RING_ILLUSTRATION}
      title="Pubky Ring"
    >
      {state.status === "verified" ? (
        <BackupStatusLine ref={passed} tabIndex={-1} tone="ok">
          Verified in Pubky Ring on {formatBackupDate(state.at)}. Pubky Ring signed in with this
          key, so it can bring this pubky back. Passport asked for no access and signed that sign-in
          out at once.
        </BackupStatusLine>
      ) : running ? (
        <div className="outline-none" ref={region} tabIndex={-1}>
          <RingHandoffScreen
            action="Verify in"
            // A computer's card says what to do in its own line below; the code needs no more.
            embedded="quiet"
            instruction={`${
              scanning
                ? `Scan this code with Pubky Ring on ${phone} and approve with this pubky.`
                : "Approve in Pubky Ring with this pubky."
            } Passport asks for no access: this only checks that Pubky Ring holds your key.`}
            navigation={
              // A computer's check ends with the page; a phone's from Cancel.
              scanning ? null : <CancelButton onClick={() => setOpened("closed")} />
            }
          >
            <div className="w-full min-w-0 outline-none" ref={handoff} tabIndex={-1}>
              <ExternalSignerRequest
                getAuthorizationUrl={() => verifier.authorizationUrl()}
                launcher={launcher}
                // A phone's press started this check: Pubky Ring opens as soon as it can.
                openOnReady={opened === "open"}
                preparing={state.status === "starting"}
                purpose="backup-verification"
                // Retried from the hand-off itself (the toast says why): a computer presses the
                // spent code, a phone Try again.
                spent={state.status === "failed" ? { onRetry: retry } : undefined}
              />
            </div>
          </RingHandoffScreen>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-5 text-secondary-foreground">
            Approve a sign-in with this key in Pubky Ring. It grants no access: it only checks that
            Pubky Ring holds your key.
          </p>
          <Button className="w-full" onClick={open} ref={start} size="lg" variant="secondary">
            <PubkyBrandIcon />
            Verify in Pubky Ring
          </Button>
        </div>
      )}
    </ChoiceCard>
  );
}
