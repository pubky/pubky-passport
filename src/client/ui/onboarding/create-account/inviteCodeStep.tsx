import { useEffect, useState } from "react";

import { isPubkyPublicKey } from "@/client/logic/pubky/pubkyIdentityKey";
import type { SignupTokenStatus } from "@/client/logic/pubky/SignupTokenChecker";
import {
  parseInviteCode,
  type HomeserverSignupDetails,
} from "@/client/logic/signup/homeserverInvite";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";
import { BackButton } from "@/client/ui/shared/backButton";
import { ArrowRightIcon, CircleCheckIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { OnboardingCard } from "@/client/ui/shared/onboardingCard";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";
import { SignupStep } from "./signupStep";

/** Waits for typing to settle; a paste settles immediately after this delay. */
const INVITE_CHECK_DELAY_MS = 300;

type InviteLookup = "idle" | "checking" | SignupTokenStatus;
type InviteCheck = InviteLookup | "format" | "confirm_homeserver";

const INVITE_CHECK_MESSAGE: Record<Exclude<InviteCheck, "idle">, string> = {
  format: "Invite codes have the form XXXX-XXXX-XXXX.",
  confirm_homeserver: "Choose Done to check this invite with the homeserver you entered.",
  checking: "Checking invite with the homeserver…",
  valid: "Invite verified with the homeserver.",
  used: "This invite has already been used. Enter a different invite.",
  not_found:
    "This homeserver does not recognize this invite. Check the code, or choose Change homeserver if the invite is from another homeserver.",
  unknown:
    "Could not check this invite with the homeserver. Check your connection and the homeserver key, or continue: the invite is checked again when your account is created.",
};

/** Looks the invite up on its homeserver whenever a well-formed code and homeserver settle. */
function useInviteCheck(invite: HomeserverSignupDetails | null): InviteLookup {
  const { checkSignupToken } = usePassportCollaborators();
  const key = invite ? `${invite.homeserverPubky}\n${invite.signupToken}` : null;
  const [checked, setChecked] = useState<{ key: string; status: SignupTokenStatus } | null>(null);

  useEffect(() => {
    if (key === null) return;
    const [homeserverPubky = "", signupToken = ""] = key.split("\n");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void checkSignupToken({ homeserverPubky, signupToken }, controller.signal).then((status) => {
        if (!controller.signal.aborted) setChecked({ key, status });
      });
    }, INVITE_CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [checkSignupToken, key]);

  if (key === null) return "idle";
  return checked?.key === key ? checked.status : "checking";
}

export function InviteCodeStep({
  homeserver,
  onBack,
  onContinue,
  initialInvite,
  error,
}: {
  /** The provider homeserver to prefill, or `""` when the instance has none. */
  homeserver: string;
  error?: string | undefined;
  onBack: () => void;
  onContinue: (invite: HomeserverSignupDetails) => void;
  initialInvite?: HomeserverSignupDetails | undefined;
}) {
  const [code, setCode] = useState(initialInvite?.signupToken ?? "");
  // Any homeserver the person holds an invite for works; the provider's only prefills the field.
  const [enteredHomeserver, setEnteredHomeserver] = useState(
    initialInvite?.homeserverPubky ?? homeserver,
  );
  const [changingHomeserver, setChangingHomeserver] = useState(
    () => !isPubkyPublicKey(enteredHomeserver.trim()),
  );
  const homeserverPubky = enteredHomeserver.trim();
  const signupToken = parseInviteCode(code);
  // A homeserver the person entered is contacted only after they confirm it with Done.
  const candidate =
    signupToken && !changingHomeserver && isPubkyPublicKey(homeserverPubky)
      ? { signupToken, homeserverPubky }
      : null;
  const lookup = useInviteCheck(candidate);
  const check: InviteCheck =
    code.trim() && !signupToken
      ? "format"
      : signupToken && changingHomeserver
        ? "confirm_homeserver"
        : lookup;
  const verified = check === "valid";
  const rejected = check === "used" || check === "not_found";
  const canContinue = candidate !== null && (verified || check === "unknown");
  return (
    <SignupStep
      title="Use"
      accent="Invite."
      description="Enter an invite from your homeserver provider to create an account."
    >
      <form
        className="flex flex-1 flex-col gap-6 md:gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (candidate && canContinue) onContinue(candidate);
        }}
      >
        <OnboardingCard illustration="/illustrations/invite.png">
          {/* The homeserver comes first: a well-formed code is looked up on it right away. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="invite-homeserver">Homeserver</Label>
              <Button
                className="h-auto px-2 py-1"
                disabled={changingHomeserver && !isPubkyPublicKey(homeserverPubky)}
                onClick={() => setChangingHomeserver((current) => !current)}
                type="button"
                variant="ghost"
              >
                {changingHomeserver ? "Done" : "Change homeserver"}
              </Button>
            </div>
            {changingHomeserver ? (
              <Input
                id="invite-homeserver"
                // Focuses the field when it opens, and first when there is no homeserver to prefill.
                autoFocus
                placeholder="Homeserver public key"
                autoComplete="off"
                spellCheck={false}
                value={enteredHomeserver}
                maxLength={52}
                onChange={(event) => setEnteredHomeserver(event.target.value)}
                containerClassName="h-14 border-dashed px-4"
              />
            ) : (
              <output
                className="block break-all rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground"
                id="invite-homeserver"
              >
                {homeserverPubky}
              </output>
            )}
          </div>
          <label htmlFor="invite-code" className="text-xl font-bold leading-7">
            Enter invite code
          </label>
          <Input
            id="invite-code"
            // Read on mount only: the code comes first once a homeserver is already chosen.
            autoFocus={!changingHomeserver}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX"
            maxLength={1024}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-invalid={rejected || undefined}
            aria-describedby={check === "idle" ? undefined : "invite-code-status"}
            containerClassName={`h-14 border-dashed px-4 ${verified ? "border-brand" : ""}`}
            className={verified ? "text-brand" : ""}
            action={verified ? <CircleCheckIcon className="text-brand" size={20} /> : undefined}
          />
          {check === "idle" ? null : (
            <FieldMessage
              aria-live="polite"
              error={rejected}
              id="invite-code-status"
              role={rejected ? "alert" : "status"}
            >
              {INVITE_CHECK_MESSAGE[check]}
            </FieldMessage>
          )}
        </OnboardingCard>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <PassportNavigation
          className="mt-auto md:mt-0"
          back={<BackButton onClick={onBack} />}
          confirm={
            <Button className="w-full" type="submit" size="lg" disabled={!canContinue}>
              <ArrowRightIcon />
              Continue
            </Button>
          }
        />
      </form>
    </SignupStep>
  );
}
