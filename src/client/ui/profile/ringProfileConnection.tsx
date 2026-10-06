import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Result } from "better-result";
import { toast } from "sonner";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type {
  PublishedProfile,
  RingConnectionErrorCode,
} from "@/client/logic/profile/RingProfileController";
import type { RingProfileControllerPort } from "@/client/ui/passportCollaborators";
import { BackButton } from "@/client/ui/shared/backButton";
import { CancelButton } from "@/client/ui/shared/cancelButton";
import { PUBKY_COPY_TOASTS } from "@/client/ui/shared/copyToClipboard";
import { DetailField } from "@/client/ui/shared/detailField";
import { shortPublicKey } from "@/client/ui/shared/formatPublicKey";
import { identityDisplayName, profileName } from "@/client/ui/shared/identityDisplay";
import { IdentitySummary } from "@/client/ui/shared/identitySummary";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Notice } from "@/client/ui/shared/notice";
import { Button } from "@/client/ui/shared/primitives/button";
import { RingHandoffScreen } from "@/client/ui/shared/ringHandoffScreen";
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

/** A failure stays until read or closed: it says what to do before pressing the spent code. */
const FAILURE_TOAST_MS = 10_000;

type ConnectionState =
  | { status: "starting" | "waiting" }
  | { status: "confirming"; publicKeyZ32: string; hasProfile: PublishedProfile; saving: boolean }
  | { status: "failed"; failure: RingConnectionErrorCode };

/**
 * Connects Pubky Ring through Passport's own profile grant: to edit `identity`'s profile, to finish
 * a Ring signup (`confirmIdentity`: the approving pubky is shown for confirmation before anything
 * is saved), or, with neither, to add whichever pubky Ring approves without changing its profile.
 * `embedded` is that last case inside the start page's Pubky Ring card: the same connection
 * without a screen of its own, where `onBack` closes it (Cancel). `appSignIn` is the connection an
 * app's sign-in leads to: the person just approved that app in Pubky Ring, so the screen says they
 * are signed in and why Ring asks once more.
 */
export function RingProfileConnection({
  appSignIn,
  controller,
  embedded = false,
  identity,
  openOnReady = false,
  setupRequired = false,
  confirmIdentity = false,
  unsavedEdits = false,
  onBack,
  onComplete,
  onDefer,
  notice,
}: {
  /**
   * Set when an app that holds a Session for `identity` waits for its profile. `requester` is the
   * app as the sign-in band names it, when something names it.
   */
  appSignIn?: { requester: string | undefined } | undefined;
  controller: RingProfileControllerPort;
  embedded?: boolean;
  /**
   * The person pressed to start this connection (a phone's start-page card): Pubky Ring opens as
   * soon as the request exists, from the button that stays in place.
   */
  openOnReady?: boolean;
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
  /** Said above the identity, such as why an app's link leads here for a key not saved yet. */
  notice?: ReactNode;
}) {
  const expectedKey = identity?.publicIdentity.publicKeyZ32;
  // A computer scans the code; a phone opens Pubky Ring.
  const mode = useRingHandoffMode();
  const [, launcher] = useDeepLinkLauncher();
  // Only a computer shows a code; a phone opens Pubky Ring, whatever became of a launch.
  const scanning = mode === "scan";
  const phone = "your phone";
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
  const handoff = useRef<HTMLDivElement>(null);
  // A retry unmounts the control that started it; once the new request is up, focus moves to it.
  const retried = attempt.id > 0;
  useLayoutEffect(() => {
    if (retried && state.status === "waiting") handoff.current?.focus({ preventScroll: true });
  }, [retried, state.status]);
  // A failure is said in a toast, not in a box under the code. One per attempt and failure.
  const failure =
    state.status === "failed"
      ? connectionError(state.failure, identity ? identityLabel(identity) : undefined)
      : undefined;
  useEffect(() => {
    if (failure)
      toast.error(failure, {
        closeButton: true,
        duration: FAILURE_TOAST_MS,
        id: `${id}-failure-${attempt.id}`,
      });
  }, [attempt.id, failure, id]);
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
        setState({
          status: "confirming",
          publicKeyZ32: progress.publicKeyZ32,
          hasProfile: progress.hasProfile,
          saving: false,
        });
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

  async function confirm() {
    if (state.status !== "confirming" || state.saving) return;
    const existing = state.hasProfile === "published";
    setState({ ...state, saving: true });
    const confirmed = await controller.confirm();
    if (Result.isError(confirmed)) {
      setState({ status: "failed", failure: confirmed.error.code });
      return;
    }
    // The person may otherwise take this pubky for the one they just created in Ring.
    if (existing)
      toast.info(`Added ${shortPublicKey(confirmed.value.publicIdentity.publicKeyZ32)}`, {
        description:
          "The pubky you just created in Pubky Ring is not in Passport yet. Add it with Sign in with Pubky Ring.",
      });
    onComplete(confirmed.value);
  }

  return (
    <RingHandoffScreen
      accent={appSignIn ? "profile." : undefined}
      action={appSignIn ? "Set up your" : "Connect"}
      // Inside the card its own line says what this is for; the button stays where it was pressed.
      embedded={embedded ? "quiet" : false}
      instruction={
        appSignIn
          ? `You’re signed in with Pubky Ring, but ${appSignIn.requester ?? "this app"} needs a public profile. ${
              scanning
                ? `Scan this code with Pubky Ring on ${phone} and approve, so Passport can create it for you.`
                : "Approve in Pubky Ring so Passport can create it for you."
            } Passport can only edit your profile and avatar; your private key stays in Pubky Ring.`
          : identity
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
        embedded ? (
          // Inside the card: Cancel on the card's edge under the hand-off.
          back ? (
            <CancelButton onClick={back} />
          ) : null
        ) : (
          <PassportNavigation
            back={back ? <BackButton onClick={back} /> : undefined}
            tertiary={
              setupRequired && defer ? (
                <Button onClick={defer} type="button" variant="link">
                  Skip for now
                </Button>
              ) : undefined
            }
          />
        )
      }
    >
      {notice}
      {identity ? <IdentityToConnect identity={identity} /> : null}
      {unsavedEdits ? (
        <Notice tone="info">Your unsaved profile changes are kept until you leave.</Notice>
      ) : null}
      {state.status === "confirming" ? (
        <section
          aria-labelledby={`${id}-confirm`}
          className="flex min-w-0 flex-col gap-4 rounded-md bg-card p-6 md:p-8"
        >
          <h2 className="text-2xl font-bold leading-8" id={`${id}-confirm`}>
            {state.hasProfile === "published"
              ? "This pubky already has a profile"
              : "Is this your new pubky?"}
          </h2>
          <DetailField label="Pubky from Pubky Ring" value={state.publicKeyZ32} />
          {state.hasProfile === "published" ? (
            // An existing account: its live profile is kept, never offered as a new one to fill.
            <>
              <p className="text-sm leading-5 text-muted-foreground">
                Pubky Ring approved a pubky that already has a public profile, so it is not the one
                you just created. Choose your new pubky in Pubky Ring, or add this one to Passport.
                Its profile stays as it is.
              </p>
              <Button
                className="w-full"
                disabled={state.saving}
                onClick={() => retry(false)}
                size="lg"
              >
                Choose again in Pubky Ring
              </Button>
              <Button
                className="w-full"
                loading={state.saving}
                onClick={() => void confirm()}
                size="lg"
                variant="outline"
              >
                Add this pubky
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm leading-5 text-muted-foreground">
                Continue only if it is the pubky you just created in Pubky Ring. Passport saves it
                and publishes your new profile to it.
              </p>
              <Button
                className="w-full"
                loading={state.saving}
                onClick={() => void confirm()}
                size="lg"
              >
                Yes, it is my new pubky
              </Button>
              <Button
                className="w-full"
                disabled={state.saving}
                onClick={() => retry(false)}
                size="lg"
                variant="outline"
              >
                No, choose again in Pubky Ring
              </Button>
            </>
          )}
        </section>
      ) : (
        <div className="w-full min-w-0 outline-none" ref={handoff} tabIndex={-1}>
          <ExternalSignerRequest
            getAuthorizationUrl={() => controller.authorizationUrl()}
            launcher={launcher}
            openOnReady={openOnReady}
            // A computer sees the code's tile at once, at its final size, while the link is made;
            // a phone its button, busy, in place.
            preparing={state.status === "starting"}
            purpose="profile-connection"
            // Retried from the hand-off itself (the toast says why): a computer presses the spent
            // code, a phone Try again. Only a storage failure keeps the approved grant.
            spent={
              state.status === "failed"
                ? { onRetry: () => retry(state.failure === "storage_failed") }
                : undefined
            }
          />
        </div>
      )}
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
  const named = profileName(identity);
  return (
    <section
      aria-label="Identity to connect"
      className="flex min-w-0 flex-col gap-4 rounded-2xl bg-card p-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* Without a profile, the name is made from the key, so the short key is not repeated. */}
        <IdentitySummary
          avatarSrc={identity.avatarUrl}
          detail={named ? shortPublicKey(publicKey) : undefined}
          name={identityDisplayName(identity)}
          profileName={named}
          publicKey={publicKey}
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
