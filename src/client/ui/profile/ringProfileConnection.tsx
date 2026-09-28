import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { Result } from "better-result";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { RingConnectionErrorCode } from "@/client/logic/profile/RingProfileController";
import type { RingProfileControllerPort } from "@/client/ui/passportCollaborators";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { RotateCcwIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { Button } from "@/client/ui/shared/primitives/button";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { ExternalSignerRequest } from "@/client/ui/universal-signer/externalSignerRequest";

/** Failures after Ring approved say so: retrying then needs a new approval in Ring. */
const CONNECTION_ERRORS: Record<RingConnectionErrorCode, string> = {
  cancelled: "This connection request was closed. Start a new request.",
  connection_failed:
    "The connection failed, either at the relay while waiting for Ring or at your homeserver after Ring approved. Try again and approve the new request in Ring.",
  expired: "This connection request expired. Start a new request.",
  grant_rejected:
    "Ring approved, but your homeserver did not accept the connection. Try again and approve the new request in Ring.",
  homeserver_unresolved:
    "Ring approved, but Passport could not find your pubky's homeserver. Try again later and approve the new request in Ring.",
  missing_capabilities:
    "Ring did not grant every permission Passport needs to edit your profile. Try again and approve the full request.",
  request_failed: "Passport could not create a connection request. Please try again.",
  storage_failed:
    "Passport could not save this identity in your browser. Free some storage and try again.",
  wrong_identity: "Choose the same identity in Ring to edit this profile.",
};

type ConnectionState =
  | { status: "starting" | "waiting" }
  | { status: "confirming"; publicKeyZ32: string }
  | { status: "failed"; failure: RingConnectionErrorCode };

/**
 * Connects Ring through Passport's own profile grant: to edit `expectedKey`'s profile, to finish a
 * Ring signup (`confirmIdentity`: the approving pubky is shown for confirmation before anything is
 * saved), or, with neither, to add whichever pubky Ring approves without changing its profile.
 */
export function RingProfileConnection({
  controller,
  expectedKey,
  setupRequired = false,
  confirmIdentity = false,
  onBack,
  onComplete,
  onDefer,
}: {
  controller: RingProfileControllerPort;
  expectedKey?: string | undefined;
  setupRequired?: boolean;
  /** After a Ring signup: Passport cannot know the new key, so the person confirms it. */
  confirmIdentity?: boolean;
  onBack: () => void;
  onComplete: (identity: LocalIdentityMetadata) => void;
  /** Leaves required setup unfinished; the identity stays usable meanwhile. */
  onDefer?: (() => void) | undefined;
}) {
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
    setState({ status: "starting" });
    setAttempt(({ id }) => ({ id: id + 1, resume }));
  }

  function confirm() {
    const confirmed = controller.confirm();
    if (Result.isError(confirmed)) setState({ status: "failed", failure: confirmed.error.code });
    else onComplete(confirmed.value);
  }

  return (
    <PassportScreen className="gap-6">
      <div className="space-y-3">
        <DisplayHeading accent="Ring." className="[&>span]:inline">
          Connect your{" "}
        </DisplayHeading>
        <LeadText>
          {expectedKey
            ? "Allow Passport to edit your public profile and avatar. Your private key stays in Ring."
            : confirmIdentity
              ? "In Ring, choose the pubky you just created and approve, so Passport can publish its profile. Your private key stays in Ring."
              : "Approve in Ring to add your pubky to Passport. Passport can then edit your public profile and avatar, and changes nothing until you do. Your private key stays in Ring."}
        </LeadText>
      </div>
      {expectedKey ? (
        <p className="break-all text-xs text-muted-foreground">Pubky: {expectedKey}</p>
      ) : null}
      {state.status === "starting" ? (
        <p className="flex items-center gap-2" role="status">
          <Spinner className="size-4" decorative />
          Preparing your connection…
        </p>
      ) : state.status === "failed" ? (
        <Notice focusOnMount tone="error">
          {CONNECTION_ERRORS[state.failure]}
        </Notice>
      ) : state.status === "confirming" ? (
        <section
          aria-labelledby={`${id}-confirm`}
          className="flex min-w-0 flex-col gap-4 rounded-lg bg-card p-6 md:p-8"
        >
          <h2 className="text-2xl font-bold leading-8" id={`${id}-confirm`}>
            Is this your new pubky?
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">Ring connected this pubky:</p>
          <p className="break-all font-mono text-sm leading-5 text-foreground">
            {state.publicKeyZ32}
          </p>
          <p className="text-sm leading-5 text-muted-foreground">
            Continue only if it is the pubky you just created in Ring. Passport saves it and
            publishes your new profile to it.
          </p>
          <Button className="w-full" onClick={confirm} size="lg">
            Yes, it is my new pubky
          </Button>
          <Button className="w-full" onClick={() => retry(false)} size="lg" variant="outline">
            No, choose again in Ring
          </Button>
        </section>
      ) : (
        <>
          <ExternalSignerRequest
            getAuthorizationUrl={() => controller.authorizationUrl()}
            purpose="profile-connection"
          />
          <p
            className="flex items-center gap-2 text-sm text-muted-foreground outline-none"
            ref={waiting}
            role="status"
            tabIndex={-1}
          >
            <Spinner className="size-4" decorative />
            Waiting for approval in Ring…
          </p>
        </>
      )}
      <PassportNavigation
        back={<BackButton onClick={onBack} />}
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
      {setupRequired && onDefer ? (
        <Button className="self-center" onClick={onDefer} type="button" variant="ghost">
          Finish later
        </Button>
      ) : null}
    </PassportScreen>
  );
}
