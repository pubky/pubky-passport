import Image from "next/image";
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { SignupEntryMethod } from "@/client/logic/homegate/verificationMethods";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { StartScreen } from "@/client/logic/universal-signer/signerNavigation";
import { IdentityEstablishmentFlow } from "@/client/ui/onboarding/identityEstablishmentFlow";
import {
  ContinueWithGoogle,
  GoogleExplanation,
  GooglePermissionHint,
} from "@/client/ui/onboarding/google/continueWithGoogle";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { OnboardingScreen } from "@/client/ui/shared/onboardingScreen";
import { ProviderTerms, usePassportProvider } from "@/client/ui/passportProviderConfiguration";
import { BroadAccessWarning } from "@/client/ui/authorization/broadAccessWarning";
import { BackButton } from "@/client/ui/shared/backButton";
import { LegalConsent } from "@/client/ui/shared/legal/legalLinks";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import {
  ArrowRightIcon,
  KeyRoundIcon,
  LogInIcon,
  UserRoundPlusIcon,
} from "@/client/ui/shared/icons";
import { PassportHeaderAction } from "@/client/ui/shared/passportHeaderAction";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { KeychainBrandIcon } from "@/client/ui/shared/brand/keychainBrands";
import { SetupProgressProvider } from "@/client/ui/shared/setupProgress";
import { useKnownRingHandoffMode } from "@/client/ui/shared/useRingHandoff";
import { useHomegateAvailability } from "@/client/ui/homegateAvailability";
import { GoogleSignupAvailability } from "@/client/ui/verificationAvailability";

/**
 * Below 22rem (the app's pop-up zoomed to 200%) the logo, the steps and a worded header action do
 * not fit one row: the action keeps its icon, and its words stay its name.
 */
const NARROW_HEADER_ACTION =
  "max-[22rem]:size-10 max-[22rem]:p-0 max-[22rem]:pointer-coarse:size-11";
const NARROW_HEADER_LABEL = "max-[22rem]:sr-only";

/**
 * Passport's own keychain connection for Sign in: a computer's whole card (`"card"`), or the part
 * inside a phone's card, which `close` (Cancel) ends.
 */
type KeychainConnection = (close: (() => void) | undefined, layout?: "card") => ReactNode;

/**
 * The start page, on one of three screens. **Join** (a new account): keys of your own, which goes
 * on to verification, or Continue with Google. **Sign in** (an identity you already have): Pubky
 * Ring or Bitkit, or a recovery file; during an app's request also Join's two ways. **Google**
 * alone, for an app whose own "Continue with Google" opened Passport: what signing in with Google
 * means, and the button. Join links to Sign in from the header; Back returns.
 *
 * During a request this is its first step when Passport has no identity to sign with (or an app's
 * "Join now" or "Continue with Google" asked for it), and Back answers the app: it returns there.
 * Opened through Use another identity, Back returns to the list instead.
 */
export function AddIdentity({
  appOffersKeychain = false,
  googleReturn,
  request,
  screen,
  onBack,
  onPrevious,
  onCancel,
  onComplete,
  onImport,
  onCreateAccount,
  onScreen,
  onUseRing,
  ringConnection,
}: {
  /**
   * The app that sent the request offers its own keychain route (its hello's `keychain` feature):
   * a request's Join then leaves "Use Pubky Ring or Bitkit" out.
   */
  appOffersKeychain?: boolean;
  /**
   * Set on the page Google returned to for a request's sign-in: the Google sign-in goes on by
   * itself instead of showing this page, and `onLeave` returns to the request's own page.
   */
  googleReturn?: { onLeave: () => void } | undefined;
  /** The request waiting behind this screen, set by the shell rather than inferred. */
  request?: AuthorizationRequestReview | undefined;
  screen: StartScreen;
  onBack?: (() => void) | undefined;
  /** Returns to the start screen this one was opened from; Back does that first. */
  onPrevious?: (() => void) | undefined;
  /** Answers the waiting app: Back on the request's first step. */
  onCancel?: (() => void) | undefined;
  onComplete: (identity: LocalIdentityMetadata) => void;
  onImport: () => void;
  /** Opens account creation, on a way to verify when one was picked. */
  onCreateAccount: (method?: SignupEntryMethod) => void;
  /** Moves between Join and Sign in. */
  onScreen: (screen: StartScreen) => void;
  /** Hands a pending app request to Pubky Ring or Bitkit unchanged. */
  onUseRing?: (() => void) | undefined;
  /**
   * Passport's own keychain connection, which adds an existing Ring or Bitkit identity: rendered
   * inside Sign in's keychain card, at once on a computer and once the person starts it on a
   * phone, where `close` takes it away again. Offered without a request.
   */
  ringConnection?: KeychainConnection | undefined;
}) {
  const forAuthorization = request !== undefined;
  const googleEnabled = usePassportProvider().features.google;
  // Back returns to the screen this one was opened from, then leaves for where addition was
  // opened; only on the request's first screen does it answer the app.
  const back = onPrevious ?? onBack ?? onCancel;
  const actions = back ? (
    <PassportNavigation back={<BackButton className="max-[30rem]:w-full" onClick={back} />} />
  ) : undefined;
  return (
    <IdentityEstablishmentFlow
      forAuthorization={forAuthorization}
      googleReturn={googleReturn}
      onComplete={onComplete}
      renderEntry={(startGoogle) => {
        // During a request with nothing saved, Join and Sign in are one screen: Join's two ways
        // in, then a recovery file and, unless the app offers its own, the keychain.
        const join = (
          <JoinScreen
            actions={actions}
            onCreateAccount={() => onCreateAccount()}
            onSignIn={() => onScreen("sign-in")}
            request={
              request
                ? {
                    capabilities: request.capabilities,
                    cookie: request.authenticationMethod === "cookie",
                    onImport,
                    onUseRing: appOffersKeychain ? undefined : onUseRing,
                  }
                : undefined
            }
            startGoogle={startGoogle}
          />
        );
        switch (screen) {
          case "join":
            return join;
          case "google":
            // An app's Google button on an instance without Google: Join offers what there is.
            if (!googleEnabled) return join;
            return <GoogleScreen actions={actions} startGoogle={startGoogle} />;
          case "sign-in":
            if (request) return join;
            return (
              <SignInScreen
                actions={actions}
                onImport={onImport}
                onJoin={() => onScreen("join")}
                ringConnection={ringConnection}
              />
            );
        }
      }}
    />
  );
}

/**
 * Join: how to create a pubky. From md two cards side by side, each with its illustration from
 * lg, as pubky.app draws them; below md the cards' names become small headings over their
 * buttons. Sovereign & Secure goes on to verification, Quick & Easy to Google. Without Google on
 * this instance the keys card stands alone.
 */
function JoinScreen({
  actions,
  onCreateAccount,
  onSignIn,
  request,
  startGoogle,
}: {
  actions: ReactNode;
  onCreateAccount: () => void;
  onSignIn: () => void;
  /**
   * An app's request waits: no Sign in in the header (Back answers the app), and under the cards
   * a recovery file and, when set, `onUseRing`, which hands the request to the keychain (Pubky
   * Ring alone for a legacy `cookie` request, which Bitkit refuses).
   */
  request?:
    | {
        capabilities: AuthorizationRequestReview["capabilities"];
        cookie: boolean;
        onImport: () => void;
        onUseRing?: (() => void) | undefined;
      }
    | undefined;
  startGoogle: () => void;
}) {
  const provider = usePassportProvider();
  const { methods, retry } = useHomegateAvailability();
  const googleSignupBlocked = methods.google.status === "blocked";
  return (
    <SetupProgressProvider current={0}>
      <OnboardingScreen
        accent="Pubky."
        actions={actions}
        lead="How would you like to create your pubky?"
        title="Let’s join"
      >
        {/* The keychain line hands the request on without its review (a phone opens the app from
            this press), so a request for broad access is flagged here first. */}
        {request?.onUseRing ? <BroadAccessWarning capabilities={request.capabilities} /> : null}
        {request ? null : (
          <PassportHeaderAction>
            <Button className={NARROW_HEADER_ACTION} onClick={onSignIn} variant="secondary">
              <LogInIcon /> <span className={NARROW_HEADER_LABEL}>Sign in</span>
            </Button>
          </PassportHeaderAction>
        )}
        <div className={cn("grid gap-6", provider.features.google && "lg:grid-cols-2")}>
          <StartOption
            description="Take full control of your pubky."
            illustration="/illustrations/identity-keys.png"
            title="Sovereign & Secure"
          >
            <Button className="w-full" onClick={onCreateAccount} size="lg" variant="secondary">
              <KeyRoundIcon /> Manage your own keys
            </Button>
          </StartOption>
          {provider.features.google ? (
            <StartOption
              description="Use your existing sign-in methods."
              illustration="/illustrations/cloud.png"
              title="Quick & Easy"
            >
              {/* The check concerns new Google sign-ups only; restoring never depends on it. */}
              <GoogleSignupAvailability availability={methods.google} onRetry={retry} />
              <ContinueWithGoogle
                label={googleSignupBlocked ? "Restore with Google" : "Continue with Google"}
                onContinue={startGoogle}
              />
            </StartOption>
          ) : null}
        </div>
        {request ? (
          <div className="flex flex-col gap-1">
            <QuietEntry
              action="Import it"
              onAction={request.onImport}
              question="Have a recovery file?"
            />
            {request.onUseRing ? (
              <p className="text-sm leading-5 pointer-coarse:-my-1.5">
                <Button onClick={request.onUseRing} variant="link">
                  {request.cookie ? "Use Pubky Ring" : "Use Pubky Ring or Bitkit"}
                </Button>
              </p>
            ) : null}
          </div>
        ) : null}
        <LegalConsent />
        <ProviderTerms />
      </OnboardingScreen>
    </SetupProgressProvider>
  );
}

/**
 * Sign in without a request: an identity the person already has. The keychain alone, Passport's
 * own connection, which adds a Pubky Ring or Bitkit identity (see `KeychainSignIn`), and the
 * import of a recovery file: Join, which it is opened from and Back returns to, has the rest (new
 * keys, Google). During a request the start page is Join (see `JoinScreen`).
 */
function SignInScreen({
  actions,
  onImport,
  onJoin,
  ringConnection,
}: {
  actions: ReactNode;
  onImport: () => void;
  onJoin: () => void;
  ringConnection?: KeychainConnection | undefined;
}) {
  return (
    <OnboardingScreen accent="Pubky" actions={actions} title="Sign in to">
      {/* Join, one Back away, has the rest (new keys, Google); only a Sign in with no way back
          offers it in the header. */}
      {actions ? null : (
        <PassportHeaderAction>
          <Button className={NARROW_HEADER_ACTION} onClick={onJoin} variant="secondary">
            <UserRoundPlusIcon /> <span className={NARROW_HEADER_LABEL}>New here?</span>
          </Button>
        </PassportHeaderAction>
      )}
      {ringConnection ? <KeychainSignIn connection={ringConnection} /> : null}
      <QuietEntry
        action="Import it"
        className="justify-center text-center"
        onAction={onImport}
        question="Have a recovery file?"
      />
      {/* A phone's screen ends on the keychain, as pubky.app's sign-in does. */}
      <Image
        alt=""
        aria-hidden="true"
        className="mx-auto size-48 object-contain md:hidden"
        height={192}
        src="/illustrations/keychain.png"
        width={192}
      />
    </OnboardingScreen>
  );
}

/**
 * The Google sign-in alone, for an app whose own "Continue with Google" opened Passport: the
 * explanation pubky.app shows in its sheet, and the button (Google's window needs a press in this
 * one). It is the first step of a Google account's creation, or a restore.
 */
function GoogleScreen({ actions, startGoogle }: { actions: ReactNode; startGoogle: () => void }) {
  const hintId = useId();
  const { methods, retry } = useHomegateAvailability();
  return (
    <SetupProgressProvider current={0}>
      <OnboardingScreen
        accent="Google."
        actions={actions}
        lead="Powered by Pubky Passport."
        title="Continue with"
      >
        <section
          aria-label="About signing in with Google"
          className="flex flex-col gap-6 rounded-lg bg-card p-6 text-base leading-6 text-muted-foreground md:p-12 lg:flex-row lg:items-center lg:gap-12"
        >
          <Image
            alt=""
            aria-hidden="true"
            className="hidden size-48 shrink-0 object-contain lg:block"
            height={192}
            src="/illustrations/cloud.png"
            width={192}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <GoogleExplanation />
            <GoogleSignupAvailability availability={methods.google} onRetry={retry} />
            <div className="flex flex-col gap-2 lg:max-w-80">
              <Button
                aria-describedby={hintId}
                className="w-full"
                onClick={startGoogle}
                size="lg"
                variant="secondary"
              >
                <GoogleLogo /> Continue with Google <ArrowRightIcon />
              </Button>
              <GooglePermissionHint id={hintId} />
            </div>
          </div>
        </section>
        <LegalConsent />
        <ProviderTerms />
      </OnboardingScreen>
    </SetupProgressProvider>
  );
}

/**
 * One way in on Join or Sign in. From md a card: its illustration in a column of its own from lg,
 * then its name, one line on what it means and its buttons. Below md the name is a small heading
 * over the buttons, as pubky.app's phone screens group them, and the line is left out.
 */
function StartOption({
  align = "center",
  children,
  description,
  frame = "responsive",
  illustration,
  title,
}: {
  /**
   * `start` keeps the text column at the top beside the illustration, for a card whose content
   * grows in place (a phone's keychain card), so the pressed button stays where it was.
   */
  align?: "center" | "start";
  children: ReactNode;
  description: string;
  /**
   * `responsive` is a card from md and a heading over its buttons below (Join, Sign in);
   * `card` a card at every width; `inside` the option's padding only, in a card it shares.
   */
  frame?: "responsive" | "card" | "inside";
  illustration: string;
  title: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-4 md:gap-6 lg:flex-row lg:items-center lg:gap-10",
        frame === "responsive" && "md:rounded-lg md:bg-card md:p-8 lg:p-12",
        // A card of its own spans the page; its content stays together in the middle, as on the
        // design's QR card, instead of leaving an empty band beside it.
        frame === "card" && "rounded-lg bg-card p-6 md:p-8 lg:justify-center lg:p-12",
        frame === "inside" && "p-6 md:p-8 lg:p-12",
        align === "start" && "lg:items-start",
      )}
    >
      {/* 160px, so the text column beside it keeps room for the Google pill on one line. */}
      <Image
        alt=""
        aria-hidden="true"
        className="hidden size-40 shrink-0 object-contain lg:block"
        height={192}
        src={illustration}
        width={192}
      />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-4 md:gap-3",
          frame === "card" && "lg:flex-none",
        )}
      >
        <h2
          className="text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground md:text-2xl md:font-bold md:normal-case md:leading-8 md:tracking-normal md:text-foreground"
          id={headingId}
        >
          {title}
        </h2>
        <p className="hidden text-base leading-6 text-muted-foreground md:mb-3 md:block">
          {description}
        </p>
        <div className="flex flex-col gap-3">{children}</div>
      </div>
    </section>
  );
}

/**
 * The keychain sign-in without a request: the connection that adds an existing Ring or Bitkit
 * identity. A computer's card is the connection's own (frame 45785-544486's QR card: the code with
 * the classic switch under it, the heading, what to do) and shows its code as soon as the page is
 * up, with nothing
 * to press and nothing to cancel (leaving the page ends it); the request is prepared after the
 * first paint, behind a placeholder of the code's size. A phone prepares nothing until its button
 * is pressed, then holds the connection (its one button, status, Cancel) until the keychain
 * approves or the person closes it. Until the browser says which of the two it is, the card shows
 * the button.
 */
function KeychainSignIn({ connection }: { connection: KeychainConnection }) {
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
  // A computer's card is the connection itself: its code, the switch under it, what to do.
  if (mode === "scan") return connection(undefined, "card");
  return (
    <StartOption
      align="start"
      // The design's Sign in frame (45785-545992) names the keychain section so; its line is Join's.
      description="Take full control of your pubky."
      illustration="/illustrations/scan.png"
      title="Sovereign & Secure"
    >
      {state === "open" ? (
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
          <KeychainBrandIcon /> Continue with Pubky Ring or Bitkit
        </Button>
      )}
    </StartOption>
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
