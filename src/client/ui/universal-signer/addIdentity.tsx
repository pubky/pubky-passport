import Image from "next/image";
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { invitesOnly, type SignupEntryMethod } from "@/client/logic/homegate/verificationMethods";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { IdentityEstablishmentFlow } from "@/client/ui/onboarding/identityEstablishmentFlow";
import { ContinueWithGoogle } from "@/client/ui/onboarding/google/continueWithGoogle";
import { BroadAccessWarning } from "@/client/ui/authorization/broadAccessWarning";
import { RequestHeading } from "@/client/ui/authorization/requestHeading";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { SHORT_WINDOW_GAP } from "@/client/ui/shared/shortWindow";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";
import { ProviderTerms, usePassportProvider } from "@/client/ui/passportProviderConfiguration";
import { BackButton } from "@/client/ui/shared/backButton";
import { ChoiceCard } from "@/client/ui/shared/choiceCard";
import { RING_ILLUSTRATION } from "@/client/ui/shared/ringHandoffCard";
import { XIcon } from "@/client/ui/shared/icons";
import { PassportHeaderAction } from "@/client/ui/shared/passportHeaderAction";
import { Button } from "@/client/ui/shared/primitives/button";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { useKnownRingHandoffMode } from "@/client/ui/shared/useRingHandoff";
import { useHomegateAvailability } from "@/client/ui/homegateAvailability";
import {
  AvailabilityNotice,
  describeBlockedMethods,
  GoogleSignupAvailability,
  useRetryOffered,
} from "@/client/ui/verificationAvailability";

/** The verification methods the instance's Homegate may offer, as the Create account card lists them. */
const HOMEGATE_METHODS = [
  { method: "sms", name: "SMS", label: "Continue with SMS", icon: "/icons/verification-phone.svg" },
  {
    method: "lightning",
    name: "Lightning",
    label: "Continue with Lightning",
    icon: "/icons/wallet.svg",
  },
] as const;

/**
 * The start page: two illustrated cards and a quiet link. **Create account** lists the ways to
 * verify a new account that this instance's Homegate offers (SMS, Lightning, Google, or an invite
 * code) as buttons, and picking one opens account creation on that method. **Pubky Ring** holds
 * the Ring sign-in itself, inside the card (see `RingCard`); during an app's request it hands the
 * request to Ring unchanged instead. Below them, a recovery file can be imported.
 *
 * During a request this is its first step when Passport has no identity to sign with. Opened
 * through Use another identity from the identity list, it leaves the Ring card out: the list
 * already offers Continue with Pubky Ring.
 */
export function AddIdentity({
  googleReturn,
  request,
  onBack,
  onCancel,
  onComplete,
  onImport,
  onCreateAccount,
  onUseRing,
  ringConnection,
}: {
  /**
   * Set on the page Google returned to for a request's sign-in: the Google sign-in goes on by
   * itself instead of showing this page, and `onLeave` returns to the request's own page.
   */
  googleReturn?: { onLeave: () => void } | undefined;
  /**
   * The request waiting behind this screen, set by the shell rather than inferred. The heading
   * names its requester with what backs that name, and the flows below keep the request layout.
   */
  request?: AuthorizationRequestReview | undefined;
  onBack?: (() => void) | undefined;
  /** Answers the waiting app from the header, when this page is the request's first step. */
  onCancel?: (() => void) | undefined;
  onComplete: (identity: LocalIdentityMetadata) => void;
  onImport: () => void;
  /** Opens account creation on the way to verify that was picked. */
  onCreateAccount: (method: SignupEntryMethod) => void;
  /** Hands a pending app request to Ring unchanged. */
  onUseRing?: (() => void) | undefined;
  /**
   * Passport's own Ring connection, which adds an existing Ring identity: rendered inside the
   * Pubky Ring card, at once on a computer and once the person starts it on a phone, where
   * `close` takes it away again. Offered without a request.
   */
  ringConnection?: ((close: (() => void) | undefined) => ReactNode) | undefined;
}) {
  const forAuthorization = request !== undefined;
  const provider = usePassportProvider();
  const { methods, retry } = useHomegateAvailability();
  // Restoring needs only Google Drive and Passport. The Homegate probe covers new identities only.
  const showGoogle = provider.features.google;
  const googleSignupBlocked = methods.google.status === "blocked";
  // Where an invite is the only way to verify, it is the card's button instead of a side entry.
  const inviteOnly = invitesOnly(methods);
  const offered = HOMEGATE_METHODS.filter(
    ({ method }) =>
      provider.verificationMethods.includes(method) &&
      // Methods still being probed keep their place so the layout does not shift under a tap.
      ["available", "blocked", "checking"].includes(methods[method].status),
  );
  const blockedSummary = describeBlockedMethods(
    offered.filter(({ method }) => methods[method].status === "blocked").map(({ name }) => name),
    [
      ...offered
        .filter(({ method }) => methods[method].status === "available")
        .map(({ name }) => name),
      "an invite code",
    ],
  );
  // The Google note carries Check again while it has a check to repeat, and one press re-checks
  // every method, so the note above it leaves its own button out meanwhile.
  const googleNoteOffered = useRetryOffered([methods.google.status]);
  const googleNoteRetries =
    showGoogle &&
    googleNoteOffered &&
    ["blocked", "unknown", "checking"].includes(methods.google.status);
  // Only when this page is the request's first step: Ring answers the waiting app itself.
  const handsRequestToRing = onUseRing !== undefined && !onBack;
  const connectsRing = ringConnection !== undefined && !request;
  const twoCards = handsRequestToRing || connectsRing;
  return (
    <IdentityEstablishmentFlow
      forAuthorization={forAuthorization}
      googleReturn={googleReturn}
      onComplete={onComplete}
      renderEntry={(startGoogle) => (
        <PassportScreen
          width={twoCards ? "wide" : "compact"}
          // Tight below the cards too, for the same 1280x800 fit.
          className={cn("gap-5 md:pb-6", forAuthorization && SHORT_WINDOW_GAP)}
        >
          {onCancel ? (
            <PassportHeaderAction>
              <Button onClick={onCancel} variant="secondary">
                <XIcon /> Cancel
              </Button>
            </PassportHeaderAction>
          ) : null}
          {request ? (
            // Compact like the identity list, and without a lead sentence, so the request's first
            // step stays as short as it can in the app's 760px popup.
            // The start page keeps the warning out: its band and heading say nobody verified
            // the request, and its review and Ring hand-off warn before anything goes on.
            <RequestHeading compact review={request} warning={false} />
          ) : (
            // Each card says what it is for, so the heading stands alone: the first screen then
            // fits a 1280x800 window without scrolling.
            <AddIdentityHeading adding={Boolean(onBack)} />
          )}
          {/* Continue with Pubky Ring below hands the request on without its review. */}
          {request ? <BroadAccessWarning capabilities={request.capabilities} /> : null}
          <div
            className={cn(
              // Side by side the cards stretch to one height, as pubky.app's do.
              "grid gap-6",
              twoCards && "lg:grid-cols-2",
              forAuthorization && SHORT_WINDOW_GAP,
            )}
          >
            {/* Creating an account comes first in the DOM, so reading and tab order match. */}
            <ChoiceCard
              compact={forAuthorization}
              dense
              split={twoCards}
              description={
                // Where an invite is the only way in, say so before the person starts.
                inviteOnly
                  ? "Create a pubky with an invite code."
                  : "Create a pubky and choose where its key lives."
              }
              illustration="/illustrations/identity-keys.png"
              title="Create account"
            >
              {offered.map(({ method, label, icon }) => (
                <Button
                  className="w-full"
                  disabled={methods[method].status === "blocked"}
                  key={method}
                  // Only the button shows the probe, so nothing else moves while it runs.
                  loading={methods[method].status === "checking"}
                  onClick={() => onCreateAccount(method)}
                  size="lg"
                  variant="secondary"
                >
                  <Image
                    alt=""
                    className="size-4 shrink-0"
                    data-slot="icon"
                    height={16}
                    src={icon}
                    width={16}
                  />{" "}
                  {label}
                </Button>
              ))}
              {blockedSummary ? (
                // A disabled button needs its reason in view; this is also its one announcement.
                <p className="text-sm leading-5 text-foreground" role="status">
                  {blockedSummary}
                </p>
              ) : null}
              <AvailabilityNotice
                methods={[methods.sms, methods.lightning]}
                onRetry={retry}
                // The buttons above show the check themselves.
                quietCheck
                retry={!googleNoteRetries}
              />
              {showGoogle ? (
                <>
                  {/* The check and its retry concern only new Google sign-ups. Restoring with
                      Google never depends on them, so the button stays either way. */}
                  <GoogleSignupAvailability availability={methods.google} onRetry={retry} />
                  <ContinueWithGoogle
                    label={googleSignupBlocked ? "Restore with Google" : "Continue with Google"}
                    onContinue={startGoogle}
                  />
                </>
              ) : null}
              {inviteOnly ? (
                <Button
                  className="w-full"
                  onClick={() => onCreateAccount("invite")}
                  size="lg"
                  variant="secondary"
                >
                  <Image
                    alt=""
                    className="size-4 shrink-0"
                    data-slot="icon"
                    height={16}
                    src="/icons/verification-invite.svg"
                    width={16}
                  />{" "}
                  Enter invite manually
                </Button>
              ) : (
                // An invite for any homeserver works on every instance, so it stays one step away.
                <QuietEntry
                  action="Enter invite manually"
                  onAction={() => onCreateAccount("invite")}
                  question="Have an invite code?"
                />
              )}
            </ChoiceCard>
            {handsRequestToRing ? (
              // The app's request goes to Ring from a button here: its code would not fit the
              // app's 760px popup beside the other card.
              <ChoiceCard
                compact={forAuthorization}
                dense
                split
                description={RING_DESCRIPTION}
                illustration={RING_ILLUSTRATION}
                title="Pubky Ring"
              >
                <Button className="w-full" onClick={onUseRing} size="lg" variant="secondary">
                  <PubkyBrandIcon /> Continue with Pubky Ring
                </Button>
              </ChoiceCard>
            ) : connectsRing ? (
              <RingCard connection={ringConnection} />
            ) : null}
          </div>
          <QuietEntry
            action="Import it"
            className="justify-center text-center"
            onAction={onImport}
            question="Have a recovery file?"
          />
          <ProviderTerms />
          {onBack ? <BackButton className="mt-3" onClick={onBack} /> : null}
        </PassportScreen>
      )}
    />
  );
}

const RING_DESCRIPTION = "Sign in with the key you keep in Pubky Ring.";

/**
 * The Pubky Ring card without a request: the sign-in that adds an existing Ring identity, inside
 * the card. A computer shows its QR code as soon as the page is up, with nothing to press and
 * nothing to cancel (leaving the page ends it); the request is prepared after the first paint,
 * behind a placeholder of the code's size. A phone prepares nothing until its button is pressed,
 * then holds the connection (its one button, status, Cancel) until Ring approves or the
 * person closes it. Until the browser says which of the two it is, the card shows the button.
 */
function RingCard({ connection }: { connection: (close: (() => void) | undefined) => ReactNode }) {
  const mode = useKnownRingHandoffMode();
  // "closed" is the card after its connection was cancelled, as opposed to never started.
  const [state, setState] = useState<"idle" | "open" | "closed">("idle");
  const region = useRef<HTMLDivElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  // Opening and closing each remove the control that was pressed, so focus follows to what
  // replaced it, without scrolling: on a phone the new button sits where the pressed one was.
  // Nothing takes focus when the page first renders.
  useLayoutEffect(() => {
    if (state === "open") region.current?.focus({ preventScroll: true });
    else if (state === "closed") start.current?.focus();
  }, [state]);
  return (
    <ChoiceCard
      dense
      description={RING_DESCRIPTION}
      illustration={RING_ILLUSTRATION}
      split
      title="Pubky Ring"
    >
      {mode === "scan" ? (
        connection(undefined)
      ) : state === "open" ? (
        <div className="outline-none" ref={region} tabIndex={-1}>
          {connection(() => setState("closed"))}
        </div>
      ) : (
        <Button
          className="w-full"
          onClick={() => setState("open")}
          ref={start}
          size="lg"
          variant="secondary"
        >
          <PubkyBrandIcon /> Sign in with Pubky Ring
        </Button>
      )}
    </ChoiceCard>
  );
}

/**
 * A question in quiet text with the text action that answers it. The question describes the
 * action, so a short label such as "Import it" is still read with what it is about.
 */
function QuietEntry({
  action,
  className,
  onAction,
  question,
}: {
  action: string;
  className?: string;
  onAction: () => void;
  question: string;
}) {
  const questionId = useId();
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-1 text-sm leading-5 text-muted-foreground",
        // A touch screen's 44px target reaches into the space around the line instead of adding
        // to the page's height.
        "pointer-coarse:-my-1.5",
        className,
      )}
    >
      <span id={questionId}>{question}</span>
      <Button aria-describedby={questionId} onClick={onAction} variant="link">
        {action}
      </Button>
    </p>
  );
}

/** Without a request the heading names the task: a first account, or one more from the switcher. */
function AddIdentityHeading({ adding }: { adding: boolean }) {
  const [lead, accent] = adding ? ["Add an", "account."] : ["Get your", "pubky."];
  return (
    <DisplayHeading accent={accent} aria-label={`${lead} ${accent}`} className="[&>span]:inline">
      {lead}{" "}
    </DisplayHeading>
  );
}
