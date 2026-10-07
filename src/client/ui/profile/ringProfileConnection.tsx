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
import { ClassicQrSwitch, useKeychainAuthMethod } from "@/client/ui/shared/classicQrSwitch";
import {
  KEYCHAIN_QR_LEAD,
  KEYCHAIN_QR_STEPS,
  KEYCHAIN_QR_TITLE,
  KeychainHandoffCard,
} from "@/client/ui/shared/keychainHandoff";
import { OnboardingScreen } from "@/client/ui/shared/onboardingScreen";
import { RingHandoffScreen } from "@/client/ui/shared/ringHandoffScreen";
import { useDeepLinkLauncher } from "@/client/ui/shared/useRingHandoff";
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
      return "The connection failed, either at the relay while waiting for your keychain or at your homeserver after it approved. Try again and approve the new request in your keychain app.";
    case "expired":
      return "This connection request expired. Start a new request.";
    case "grant_rejected":
      return "Your keychain approved, but your homeserver did not accept the connection. Try again and approve the new request in your keychain app.";
    case "homeserver_unresolved":
      return "Your keychain approved, but Passport could not find your pubky's homeserver. Try again later and approve the new request in your keychain app.";
    case "missing_capabilities":
      return "Your keychain did not grant every permission Passport needs to edit your profile. Try again and approve the full request.";
    case "request_failed":
      return "Passport could not create a connection request. Please try again.";
    case "storage_failed":
      return "Passport could not save this identity in your browser. Free some storage and try again.";
    case "wrong_identity":
      return expected
        ? `Your keychain approved a different identity. In your keychain app, choose ${expected}, then try again.`
        : "Your keychain approved a different identity. Choose the one you want to connect, then try again.";
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
  /** Looking for the profile grant this browser stored for the identity; nothing shows yet. */
  | { status: "resuming" }
  | { status: "starting" | "waiting" }
  | { status: "confirming"; publicKeyZ32: string; hasProfile: PublishedProfile; saving: boolean }
  | { status: "failed"; failure: RingConnectionErrorCode };

/**
 * Connects Pubky Ring through Passport's own profile grant: to edit `identity`'s profile, to finish
 * a Ring signup (`confirmIdentity`: the approving pubky is shown for confirmation before anything
 * is saved), or, with neither, to add whichever pubky Ring approves without changing its profile.
 * `embedded` is that last case on the start page's Sign in, without a screen of its own: `"card"`
 * is a computer's whole keychain card (the code with its switch, the heading and what to do);
 * `true` sits inside a phone's card, where `onBack` closes it (Cancel). `appSignIn` is the connection an
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
  embedded?: boolean | "card";
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
  const [, launcher] = useDeepLinkLauncher();
  // Leaving with edits waiting for this connection asks first, as the editor's own Back does.
  const [leaving, setLeaving] = useState<() => void>();
  const confirmLeaving = (leave: (() => void) | undefined) =>
    leave && unsavedEdits ? () => setLeaving(() => leave) : leave;
  const back = confirmLeaving(onBack);
  const defer = confirmLeaving(onDefer);
  // A known identity whose profile grant this browser keeps connects without the keychain; the
  // screen shows only if none is stored. The legacy cookie sign-in is never stored.
  // Older Pubky Ring needs the legacy request: switching asks again, the other way.
  const method = useKeychainAuthMethod();
  const resumable =
    expectedKey !== undefined && controller.resume !== undefined && method === "grant";
  const [state, setState] = useState<ConnectionState>({
    status: resumable ? "resuming" : "starting",
  });
  const [attempt, setAttempt] = useState({ id: 0, resume: false });
  const [requestedMethod, setRequestedMethod] = useState(method);
  if (method !== requestedMethod) {
    setRequestedMethod(method);
    setState({ status: "starting" });
    // A new request of the other kind: an approval being resumed belongs to the old one.
    setAttempt(({ id }) => ({ id, resume: false }));
  }
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
    async function begin() {
      if (resumable && attempt.id === 0) {
        const resumed = await controller.resume?.({ expectedKey, setupRequired });
        if (!active) return;
        if (resumed && Result.isOk(resumed) && resumed.value) {
          complete(resumed.value);
          return;
        }
        setState({ status: "starting" });
      }
      const result = await controller.start({
        expectedKey,
        setupRequired,
        confirmIdentity,
        method,
      });
      if (!active) return;
      if (Result.isError(result)) {
        setState({ status: "failed", failure: result.error.code });
        return;
      }
      setState({ status: "waiting" });
      void poll();
    }
    if (attempt.resume) void poll();
    else void begin();
    return () => {
      active = false;
      clearTimeout(timer);
      // Saving the identity can switch views before the poll continuation runs.
      if (!keepConnection.current && !controller.isConnected(expectedKey)) controller.dispose();
    };
  }, [controller, expectedKey, setupRequired, confirmIdentity, attempt, method, resumable]);

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
          "The pubky you just created in your keychain is not in Passport yet. Add it from Sign in with your keychain.",
      });
    onComplete(confirmed.value);
  }

  // One short line: the card lists the steps, and the keychain app shows what it grants.
  const instruction = appSignIn
    ? `You’re signed in, but ${appSignIn.requester ?? "this app"} needs a public profile. Approve in your keychain so Passport can create it.`
    : identity
      ? "Approve in your keychain so Passport can edit your public profile."
      : confirmIdentity
        ? "Approve with the pubky you just created so Passport can publish its profile."
        : "Approve in your keychain to add your pubky. Passport changes nothing until you do.";
  const request = (
    <div className="w-full min-w-0 outline-none" ref={handoff} tabIndex={-1}>
      <ExternalSignerRequest
        bare
        buttonVariant="secondary"
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
  );
  const confirmation =
    state.status === "confirming" ? (
      <section
        aria-labelledby={`${id}-confirm`}
        className="flex min-w-0 flex-col gap-4 rounded-md bg-card p-6 md:p-8"
      >
        <h2 className="text-2xl font-bold leading-8" id={`${id}-confirm`}>
          {state.hasProfile === "published"
            ? "This pubky already has a profile"
            : "Is this your new pubky?"}
        </h2>
        <DetailField label="Pubky from your keychain" value={state.publicKeyZ32} />
        {state.hasProfile === "published" ? (
          // An existing account: its live profile is kept, never offered as a new one to fill.
          <>
            <p className="text-sm leading-5 text-muted-foreground">
              Your keychain approved a pubky that already has a public profile, so it is not the one
              you just created. Choose your new pubky in your keychain app, or add this one to
              Passport. Its profile stays as it is.
            </p>
            <Button
              className="w-full"
              disabled={state.saving}
              onClick={() => retry(false)}
              size="lg"
            >
              Choose again in your keychain
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
              Continue only if it is the pubky you just created in your keychain app. Passport saves
              it and publishes your new profile to it.
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
              No, choose again in your keychain
            </Button>
          </>
        )}
      </section>
    ) : null;
  const discardDialog = unsavedEdits ? (
    <DiscardChangesDialog
      onDiscard={() => {
        const leave = leaving;
        setLeaving(undefined);
        leave?.();
      }}
      onKeepEditing={() => setLeaving(undefined)}
      open={leaving !== undefined}
    />
  ) : null;

  // Until it is known whether a stored grant connects the identity, nothing asks for the keychain.
  if (state.status === "resuming") return null;

  if (embedded === "card")
    return (
      <>
        {notice}
        {confirmation ?? (
          <KeychainHandoffCard
            footer={<ClassicQrSwitch />}
            handoff={request}
            instructions={KEYCHAIN_QR_STEPS}
            label={KEYCHAIN_QR_TITLE}
            lead={KEYCHAIN_QR_LEAD}
            title={KEYCHAIN_QR_TITLE}
          />
        )}
        {discardDialog}
      </>
    );

  if (embedded)
    return (
      // Inside the start page's card its own line says what this is for; the button stays where
      // it was pressed, and Cancel sits on the card's edge under the hand-off.
      <RingHandoffScreen
        action="Connect"
        embedded="quiet"
        instruction={instruction}
        navigation={back ? <CancelButton onClick={back} /> : null}
      >
        {notice}
        {confirmation ?? (
          <>
            {request}
            <ClassicQrSwitch />
          </>
        )}
        {discardDialog}
      </RingHandoffScreen>
    );

  return (
    <OnboardingScreen
      accent={appSignIn ? "profile." : "keychain."}
      actions={
        <PassportNavigation
          back={back ? <BackButton className="max-[30rem]:w-full" onClick={back} /> : undefined}
          tertiary={
            setupRequired && defer ? (
              <Button onClick={defer} type="button" variant="link">
                Skip for now
              </Button>
            ) : undefined
          }
        />
      }
      lead={instruction}
      title={appSignIn ? "Set up your" : "Connect your"}
    >
      {notice}
      {identity ? <IdentityToConnect identity={identity} /> : null}
      {unsavedEdits ? (
        <Notice tone="info">Your unsaved profile changes are kept until you leave.</Notice>
      ) : null}
      {confirmation ?? (
        <KeychainHandoffCard
          footer={<ClassicQrSwitch />}
          handoff={request}
          instructions={KEYCHAIN_QR_STEPS}
          label="Keychain connection"
        />
      )}
      {discardDialog}
    </OnboardingScreen>
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
