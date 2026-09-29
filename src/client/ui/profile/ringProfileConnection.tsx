import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { Result } from "better-result";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { RingConnectionErrorCode } from "@/client/logic/profile/RingProfileController";
import type { RingProfileControllerPort } from "@/client/ui/passportCollaborators";
import { BackButton } from "@/client/ui/shared/backButton";
import { PUBKY_COPY_TOASTS } from "@/client/ui/shared/copyToClipboard";
import { DetailField } from "@/client/ui/shared/detailField";
import { shortPublicKey } from "@/client/ui/shared/formatPublicKey";
import { identityDisplayName, profileName, unnamedKey } from "@/client/ui/shared/identityDisplay";
import { IdentitySummary } from "@/client/ui/shared/identitySummary";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { RotateCcwIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { Button } from "@/client/ui/shared/primitives/button";
import { RingHandoffScreen, RingHandoffStatus } from "@/client/ui/shared/ringHandoffScreen";
import { useDeepLinkLauncher, useRingHandoffMode } from "@/client/ui/shared/useRingHandoff";
import { ExternalSignerRequest } from "@/client/ui/universal-signer/externalSignerRequest";
import { DiscardChangesDialog } from "./discardChangesDialog";

/**
 * Failures after Pubky Ring approved say so: retrying then needs a new approval there. A different
 * identity is named by the one to choose (`expected`), when there is one.
 */
function connectionError(code: RingConnectionErrorCode, expected: string | undefined): string {
  switch (code) {
    case "cancelled":
      return "This connection request was closed. Start a new request.";
    case "connection_failed":
      return "The connection failed, either at the relay while waiting for Pubky Ring or at your homeserver after Pubky Ring approved. Try again and approve the new request in Pubky Ring.";
    case "expired":
      return "This connection request expired. Start a new request.";
    case "grant_rejected":
      return "Pubky Ring approved, but your homeserver did not accept the connection. Try again and approve the new request in Pubky Ring.";
    case "homeserver_unresolved":
      return "Pubky Ring approved, but Passport could not find your pubky's homeserver. Try again later and approve the new request in Pubky Ring.";
    case "missing_capabilities":
      return "Pubky Ring did not grant every permission Passport needs to edit your profile. Try again and approve the full request.";
    case "request_failed":
      return "Passport could not create a connection request. Please try again.";
    case "storage_failed":
      return "Passport could not save this identity in your browser. Free some storage and try again.";
    case "wrong_identity":
      return expected
        ? `Pubky Ring approved a different identity. In Pubky Ring, choose ${expected}, then try again.`
        : "Pubky Ring approved a different identity. Choose the one you want to connect, then try again.";
  }
}

/** How the connection names an identity to choose in Pubky Ring: its name and short key. */
function identityLabel(identity: LocalIdentityMetadata): string {
  const shortKey = shortPublicKey(identity.publicIdentity.publicKeyZ32);
  const name = profileName(identity);
  return name ? `${name} (${shortKey})` : `the pubky ${shortKey}`;
}

type ConnectionState =
  | { status: "starting" | "waiting" }
  | { status: "confirming"; publicKeyZ32: string }
  | { status: "failed"; failure: RingConnectionErrorCode };

/**
 * Connects Pubky Ring through Passport's own profile grant: to edit `identity`'s profile, to finish
 * a Ring signup (`confirmIdentity`: the approving pubky is shown for confirmation before anything
 * is saved), or, with neither, to add whichever pubky Ring approves without changing its profile.
 */
export function RingProfileConnection({
  controller,
  identity,
  setupRequired = false,
  confirmIdentity = false,
  unsavedEdits = false,
  onBack,
  onComplete,
  onDefer,
}: {
  controller: RingProfileControllerPort;
  /** The saved identity whose profile Passport connects to edit; Ring must approve this one. */
  identity?: LocalIdentityMetadata | undefined;
  setupRequired?: boolean;
  /** After a Ring signup: Passport cannot know the new key, so the person confirms it. */
  confirmIdentity?: boolean;
  /** Profile edits wait for this connection; leaving (Back, Skip for now) asks before losing them. */
  unsavedEdits?: boolean;
  /** Absent right after an identity was added, where Skip for now is the one way on. */
  onBack?: (() => void) | undefined;
  onComplete: (identity: LocalIdentityMetadata) => void;
  /** Leaves required setup unfinished; the identity stays usable meanwhile. */
  onDefer?: (() => void) | undefined;
}) {
  const expectedKey = identity?.publicIdentity.publicKeyZ32;
  // A computer scans the code, and so does a phone whose link did not open Pubky Ring.
  const mode = useRingHandoffMode();
  const [launch, launcher] = useDeepLinkLauncher();
  const scanning = mode === "scan" || launch === "failed";
  const phone = mode === "scan" ? "your phone" : "another phone";
  // Leaving with edits waiting for this connection asks first, as the editor's own Back does.
  const [leaving, setLeaving] = useState<() => void>();
  const confirmLeaving = (leave: (() => void) | undefined) =>
    leave && unsavedEdits ? () => setLeaving(() => leave) : leave;
  const back = confirmLeaving(onBack);
  const defer = confirmLeaving(onDefer);
  const [state, setState] = useState<ConnectionState>({ status: "starting" });
  const [attempt, setAttempt] = useState({ id: 0, resume: false });
  /** Set while a retry reuses the grant Ring already approved, so cleanup must keep it. */
  const keepConnection = useRef(false);
  const complete = useEffectEvent(onComplete);
  const id = useId();
  const waiting = useRef<HTMLParagraphElement>(null);
  // A retry unmounts the control that started it; once Ring is waiting, focus the wait.
  const retried = attempt.id > 0;
  useLayoutEffect(() => {
    if (retried && state.status === "waiting") waiting.current?.focus();
  }, [retried, state.status]);
  // Try again stays mounted while its new request is prepared, so focus stays on it.
  const [retryPressed, setRetryPressed] = useState(false);
  if (retryPressed && state.status !== "starting") setRetryPressed(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    keepConnection.current = false;
    async function poll() {
      const result = await controller.poll();
      if (!active) return;
      if (Result.isError(result)) {
        setState({ status: "failed", failure: result.error.code });
        return;
      }
      const progress = result.value;
      if (progress.status === "connected") {
        complete(progress.identity);
        return;
      }
      if (progress.status === "approved") {
        setState({ status: "confirming", publicKeyZ32: progress.publicKeyZ32 });
        return;
      }
      timer = setTimeout(() => void poll(), 1_500);
    }
    if (attempt.resume) void poll();
    else
      void controller.start({ expectedKey, setupRequired, confirmIdentity }).then((result) => {
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
      // Saving the identity can switch views before the poll continuation runs.
      if (!keepConnection.current && !controller.isConnected(expectedKey)) controller.dispose();
    };
  }, [controller, expectedKey, setupRequired, confirmIdentity, attempt]);

  /** Only a storage failure keeps the approved grant; anything else needs a new request. */
  function retry(resume: boolean) {
    keepConnection.current = resume;
    // A new request gets its own link, which may open Pubky Ring this time.
    launcher?.reset();
    setState({ status: "starting" });
    setAttempt(({ id }) => ({ id: id + 1, resume }));
  }

  function confirm() {
    const confirmed = controller.confirm();
    if (Result.isError(confirmed)) setState({ status: "failed", failure: confirmed.error.code });
    else onComplete(confirmed.value);
  }

  return (
    <RingHandoffScreen
      action="Connect"
      instruction={
        identity
          ? scanning
            ? `Scan this code with Pubky Ring on ${phone}, then approve so Passport can edit your public profile and avatar. Your private key stays in Pubky Ring.`
            : "Approve in Pubky Ring so Passport can edit your public profile and avatar. Your private key stays in Pubky Ring."
          : confirmIdentity
            ? scanning
              ? `Scan this code with Pubky Ring on ${phone}, choose the pubky you just created and approve, so Passport can publish its profile. Your private key stays in Pubky Ring.`
              : "In Pubky Ring, choose the pubky you just created and approve, so Passport can publish its profile. Your private key stays in Pubky Ring."
            : scanning
              ? `Scan this code with Pubky Ring on ${phone} and approve to add your pubky to Passport. Passport can then edit your public profile and avatar, and changes nothing until you do. Your private key stays in Pubky Ring.`
              : "Approve in Pubky Ring to add your pubky to Passport. Passport can then edit your public profile and avatar, and changes nothing until you do. Your private key stays in Pubky Ring."
      }
      navigation={
        <PassportNavigation
          back={back ? <BackButton onClick={back} /> : undefined}
          tertiary={
            setupRequired && defer ? (
              <Button onClick={defer} type="button" variant="link">
                Skip for now
              </Button>
            ) : undefined
          }
          confirm={
            state.status === "failed" || retryPressed ? (
              <Button
                className="w-full"
                loading={retryPressed}
                onClick={() => {
                  if (state.status !== "failed") return;
                  setRetryPressed(true);
                  retry(state.failure === "storage_failed");
                }}
                size="lg"
              >
                <RotateCcwIcon />
                Try again
              </Button>
            ) : undefined
          }
        />
      }
      // Passport polls for the approval here, so the line shows it is waiting.
      status={
        state.status === "starting" ? (
          <RingHandoffStatus waiting>Preparing your connection…</RingHandoffStatus>
        ) : state.status === "waiting" ? (
          <RingHandoffStatus ref={waiting} waiting>
            Waiting for approval in Pubky Ring…
          </RingHandoffStatus>
        ) : undefined
      }
    >
      {identity ? <IdentityToConnect identity={identity} /> : null}
      {unsavedEdits ? (
        <Notice tone="info">Your unsaved profile changes are kept until you leave.</Notice>
      ) : null}
      {state.status === "failed" ? (
        <Notice focusOnMount tone="error">
          {connectionError(state.failure, identity ? identityLabel(identity) : undefined)}
        </Notice>
      ) : state.status === "confirming" ? (
        <section
          aria-labelledby={`${id}-confirm`}
          className="flex min-w-0 flex-col gap-4 rounded-lg bg-card p-6 md:p-8"
        >
          <h2 className="text-2xl font-bold leading-8" id={`${id}-confirm`}>
            Is this your new pubky?
          </h2>
          <DetailField label="Pubky from Pubky Ring" value={state.publicKeyZ32} />
          <p className="text-sm leading-5 text-muted-foreground">
            Continue only if it is the pubky you just created in Pubky Ring. Passport saves it and
            publishes your new profile to it.
          </p>
          <Button className="w-full" onClick={confirm} size="lg">
            Yes, it is my new pubky
          </Button>
          <Button className="w-full" onClick={() => retry(false)} size="lg" variant="outline">
            No, choose again in Pubky Ring
          </Button>
        </section>
      ) : state.status === "waiting" ? (
        <ExternalSignerRequest
          getAuthorizationUrl={() => controller.authorizationUrl()}
          launcher={launcher}
          purpose="profile-connection"
        />
      ) : null}
      {unsavedEdits ? (
        <DiscardChangesDialog
          onDiscard={() => {
            const leave = leaving;
            setLeaving(undefined);
            leave?.();
          }}
          onKeepEditing={() => setLeaving(undefined)}
          open={leaving !== undefined}
        />
      ) : null}
    </RingHandoffScreen>
  );
}

/** The identity Pubky Ring must approve: as the identity lists show it, then its full key. */
function IdentityToConnect({ identity }: { identity: LocalIdentityMetadata }) {
  const publicKey = identity.publicIdentity.publicKeyZ32;
  const unnamed = unnamedKey(identity);
  return (
    <section
      aria-label="Identity to connect"
      className="flex min-w-0 flex-col gap-4 rounded-2xl bg-card p-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* Without a profile, the name is made from the key, so the short key is not repeated. */}
        <IdentitySummary
          avatarSrc={identity.avatarUrl}
          detail={unnamed ? undefined : shortPublicKey(publicKey)}
          name={identityDisplayName(identity)}
          unnamedKey={unnamed}
        />
      </div>
      <DetailField
        copy={{ ...PUBKY_COPY_TOASTS, value: publicKey }}
        label="Pubky"
        value={publicKey}
      />
    </section>
  );
}
