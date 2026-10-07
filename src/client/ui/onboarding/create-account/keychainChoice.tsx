import { useId, useState } from "react";

import { BackButton } from "@/client/ui/shared/backButton";
import { KeychainApps, KeychainBrandIcon } from "@/client/ui/shared/brand/keychainBrands";
import { AppWindowIcon, ArrowRightIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { OnboardingScreen } from "@/client/ui/shared/onboardingScreen";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { Dialog } from "@/client/ui/shared/primitives/dialog";

/** What keeping the key in this browser gives up, as pubky.app's sheet lists it. */
const BROWSER_TRADEOFFS = [
  "Browser-based key generation",
  "Less secure than mobile keychain",
  "Suboptimal sign-in experience",
];

/**
 * Identity keys: where the new account's key lives. One card presents both keychain apps (Pubky
 * Ring and Bitkit read the same request, so there is one way on for both), with where to get
 * them. Keeping the key in this browser instead is a quiet link that first lists its tradeoffs.
 * After a verification that just succeeded, the screen also offers to discard it while nothing
 * has used it yet.
 */
export function KeychainChoice({
  onPassport,
  onRing,
  onBack,
  onLeave,
  onDiscardInvite,
  inviteSaved,
  restored,
  registrationStarted,
  checkingInvite,
  error,
}: {
  onPassport: () => void | Promise<void>;
  onRing: () => void;
  /** Returns to the invite entry, while the entered invite can still be changed. */
  onBack?: (() => void) | undefined;
  /** Leaves account creation; an unsubmitted key is dropped. */
  onLeave: () => void;
  onDiscardInvite?: (() => void) | undefined;
  /** The invite came from SMS or Lightning verification and is kept for a later visit. */
  inviteSaved: boolean;
  /**
   * What an earlier visit left in this browser: a key whose setup was started (`setup`), or a
   * verification that issued the invite (`verification`).
   */
  restored?: "setup" | "verification" | undefined;
  registrationStarted: boolean;
  checkingInvite: boolean;
  error?: string | undefined;
}) {
  // Both choices wait on the same invite check; only the one pressed shows it.
  const [choice, setChoice] = useState<"ring" | "passport" | null>(null);
  if (choice && !checkingInvite) setChoice(null);
  const [weighingBrowser, setWeighingBrowser] = useState(false);
  const tradeoffsTitleId = useId();
  const welcomeBack = restored ? (
    <Notice tone="info">
      {restored === "setup"
        ? "Welcome back. The setup you started is saved in this browser, so you can pick up where you left off."
        : "Welcome back. Your verification is saved in this browser, so you don’t need to verify again."}
    </Notice>
  ) : null;
  const errorNotice = error ? (
    <Notice focusOnMount tone="error">
      {error}
    </Notice>
  ) : null;
  const back = <BackButton className="max-[30rem]:w-full" onClick={onBack ?? onLeave} />;
  const keepInBrowser = () => {
    setWeighingBrowser(false);
    setChoice("passport");
    void onPassport();
  };

  // Signup was submitted with the key saved in this browser, which may already own the account:
  // only that key can finish it, so there is nothing left to choose.
  if (registrationStarted)
    return (
      <OnboardingScreen
        accent="account."
        // Its actions lead on: pinned to a phone's window.
        stickyActions
        actions={
          <PassportNavigation
            back={back}
            confirm={
              <Button
                className="w-full"
                disabled={checkingInvite}
                loading={choice === "passport"}
                onClick={() => {
                  setChoice("passport");
                  void onPassport();
                }}
                size="lg"
              >
                <ArrowRightIcon />
                Continue
              </Button>
            }
          />
        }
        lead="You started creating an account with a key saved in this browser. Continue to finish it with that key."
        title="Finish your"
      >
        {welcomeBack}
        {errorNotice}
      </OnboardingScreen>
    );

  return (
    <OnboardingScreen
      accent="keychain."
      actions={
        <PassportNavigation
          // Back, not Cancel: leaving account creation does not answer the app's request.
          back={back}
          tertiary={
            onDiscardInvite ? (
              <Button disabled={checkingInvite} onClick={onDiscardInvite} variant="linkDestructive">
                Discard verification
              </Button>
            ) : undefined
          }
        />
      }
      lead="Install a keychain for your identity keys."
      title="Pick your"
    >
      {welcomeBack}
      <section
        aria-label="Keychain apps"
        className="flex min-w-0 flex-col gap-6 rounded-lg bg-card p-6 md:p-12"
      >
        {/* Each app in the design's own words; one button for both (decision 2). */}
        <KeychainApps />
        <Button
          className="w-full md:w-fit md:min-w-80"
          disabled={checkingInvite}
          loading={choice === "ring"}
          onClick={() => {
            setChoice("ring");
            onRing();
          }}
          size="lg"
          variant="secondary"
        >
          <KeychainBrandIcon /> {choice === "ring" ? "Checking invite…" : "Continue with keychain"}
        </Button>
      </section>
      {errorNotice}
      <p className="text-sm leading-5 pointer-coarse:-my-1.5">
        <Button
          disabled={checkingInvite}
          loading={choice === "passport"}
          onClick={() => setWeighingBrowser(true)}
          variant="link"
        >
          {choice === "passport" ? "Checking invite…" : "Keep key in this browser"}
        </Button>
      </p>
      {inviteSaved && !onBack && !restored ? (
        <p className="text-sm leading-5 text-muted-foreground">
          Your verification stays saved in this browser.
        </p>
      ) : null}
      <Dialog
        aria-labelledby={tradeoffsTitleId}
        onOpenChange={setWeighingBrowser}
        open={weighingBrowser}
        variant="sheet"
      >
        <div className="flex flex-col gap-6">
          <div aria-hidden="true" className="mx-auto h-1.5 w-16 rounded-full bg-muted sm:hidden" />
          <h2 className="text-center text-xl font-bold leading-7" id={tradeoffsTitleId}>
            Be aware of these tradeoffs:
          </h2>
          <ul className="list-disc space-y-1 pl-6 text-base leading-6 text-muted-foreground">
            {BROWSER_TRADEOFFS.map((tradeoff) => (
              <li key={tradeoff}>{tradeoff}</li>
            ))}
          </ul>
          <div className="flex flex-col gap-3">
            <Button
              className="w-full"
              onClick={() => setWeighingBrowser(false)}
              size="lg"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button className="w-full" onClick={keepInBrowser} size="lg" variant="secondary">
              <AppWindowIcon /> Create in browser anyway
            </Button>
          </div>
        </div>
      </Dialog>
    </OnboardingScreen>
  );
}
