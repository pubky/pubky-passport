import { useEffect, useRef, useState } from "react";

import { isPubkyPublicKey } from "@/client/logic/pubky/pubkyIdentityKey";
import type { SignupTokenStatus } from "@/client/logic/pubky/SignupTokenChecker";
import {
  parseInviteCode,
  type HomeserverSignupDetails,
} from "@/client/logic/signup/homeserverInvite";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";
import { ProviderTerms } from "@/client/ui/passportProviderConfiguration";
import { BALANCED_KEY_CLASS, BalancedKeyText } from "@/client/ui/shared/balancedKey";
import { BackButton } from "@/client/ui/shared/backButton";
import { ArrowRightIcon, CircleCheckIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { OnboardingCard } from "@/client/ui/shared/onboardingCard";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { cn } from "@/client/ui/shared/mergeClassNames";
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
  confirm_homeserver: "Passport checks this invite once the homeserver key above is checked.",
  checking: "Checking invite with the homeserver…",
  valid: "Invite verified with the homeserver.",
  used: "This invite has already been used. Enter a different invite.",
  not_found:
    "This homeserver does not recognize this invite. Check the code, or choose Change homeserver if the invite is from another homeserver.",
  unknown:
    "Could not check this invite with the homeserver. Check your connection and the homeserver key, or continue: the invite is checked again when your account is created.",
};

type HomeserverCheck = "idle" | "invalid" | "checking" | "reachable" | "unreachable";

/**
 * Checks an entered homeserver key when the person leaves the field (or opens it with a key in
 * it): the form first, then whether the homeserver answers. Each value is looked up once; leaving
 * the field again without changing it reuses the answer.
 */
function useHomeserverCheck(homeserverPubky: string) {
  const { checkHomeserver } = usePassportCollaborators();
  const [checked, setChecked] = useState<{ key: string; status: HomeserverCheck } | null>(null);
  const lookup = useRef<AbortController | null>(null);

  useEffect(() => () => lookup.current?.abort(), []);

  function check(key: string) {
    if (checked?.key === key) return;
    lookup.current?.abort();
    if (!key) return setChecked(null);
    if (!isPubkyPublicKey(key)) return setChecked({ key, status: "invalid" });
    const controller = new AbortController();
    lookup.current = controller;
    setChecked({ key, status: "checking" });
    void checkHomeserver(key, controller.signal).then((reached) => {
      if (!controller.signal.aborted)
        setChecked({ key, status: reached ? "reachable" : "unreachable" });
    });
  }

  // An answer about another value says nothing about what is in the field now.
  const status: HomeserverCheck = checked?.key === homeserverPubky ? checked.status : "idle";
  return { check, status };
}

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
  onChooseAnotherMethod,
  initialInvite,
  inviteOnly = false,
  error,
}: {
  /** The provider homeserver to prefill, or `""` when the instance has none. */
  homeserver: string;
  error?: string | undefined;
  onBack: () => void;
  onContinue: (invite: HomeserverSignupDetails) => void;
  /** Returns to the other ways to verify; offered when the homeserver refuses this invite. */
  onChooseAnotherMethod?: (() => void) | undefined;
  initialInvite?: HomeserverSignupDetails | undefined;
  /** An invite is the only way to create an account here, so this step opens account creation. */
  inviteOnly?: boolean;
}) {
  const [code, setCode] = useState(initialInvite?.signupToken ?? "");
  // Any homeserver the person holds an invite for works; the provider's only prefills the field.
  const [enteredHomeserver, setEnteredHomeserver] = useState(
    initialInvite?.homeserverPubky ?? homeserver,
  );
  const [changingHomeserver, setChangingHomeserver] = useState(
    () => !isPubkyPublicKey(enteredHomeserver.trim()),
  );
  const codeField = useRef<HTMLInputElement>(null);
  const homeserverPubky = enteredHomeserver.trim();
  const homeserverCheck = useHomeserverCheck(homeserverPubky);
  const homeserverInvalid =
    changingHomeserver &&
    (homeserverCheck.status === "invalid" || homeserverCheck.status === "unreachable");
  const homeserverReachable = changingHomeserver && homeserverCheck.status === "reachable";
  // An entered homeserver is used once it has been checked; one that did not answer may only be
  // unreachable from here, so the invite lookup still gets its say, as it does for any homeserver.
  const homeserverSettled =
    !changingHomeserver ||
    homeserverCheck.status === "reachable" ||
    homeserverCheck.status === "unreachable";
  const signupToken = parseInviteCode(code);
  const candidate =
    signupToken && homeserverSettled && isPubkyPublicKey(homeserverPubky)
      ? { signupToken, homeserverPubky }
      : null;
  const lookup = useInviteCheck(candidate);
  const check: InviteCheck =
    code.trim() && !signupToken
      ? "format"
      : signupToken && !homeserverSettled
        ? "confirm_homeserver"
        : lookup;
  const verified = check === "valid";
  const rejected = check === "used" || check === "not_found";
  const canContinue = candidate !== null && (verified || check === "unknown");

  return (
    <SignupStep
      title="Use an"
      accent="invite."
      description={
        inviteOnly
          ? "Creating an account here needs an invite code. Enter the one you received."
          : "Enter the invite code you received to create your account."
      }
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
          {changingHomeserver ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-homeserver">Homeserver public key</Label>
              {/* Sized to its content where the browser can do that (at least two lines), so all
                  52 characters stay in view to compare with the key given. Elsewhere the field
                  cannot grow, so it starts with the lines a key needs at that width: three on a
                  phone, four in a popup zoomed to 200%. */}
              <textarea
                id="invite-homeserver"
                // Focuses the field when it opens, and first when there is no homeserver to prefill.
                autoFocus
                rows={2}
                placeholder="52 letters and digits"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={enteredHomeserver}
                maxLength={64}
                aria-invalid={homeserverInvalid || undefined}
                aria-describedby={
                  homeserverInvalid ? "invite-homeserver-error" : "invite-homeserver-hint"
                }
                className={cn(
                  "field-sizing-content min-h-[calc(4.5rem+2px)] w-full resize-none break-all rounded-lg border border-dashed border-input bg-black/10 px-4 py-3 text-base font-medium leading-6 placeholder:text-muted-foreground aria-invalid:border-destructive max-sm:not-supports-[field-sizing:content]:min-h-[calc(6rem+2px)] max-[17rem]:not-supports-[field-sizing:content]:min-h-[calc(7.5rem+2px)]",
                  homeserverReachable && "border-brand text-brand",
                )}
                // A key has no spaces; line breaks from a paste are dropped.
                onChange={(event) => setEnteredHomeserver(event.target.value.replace(/\s+/gu, ""))}
                // A key is checked when the person leaves the field, never mid-paste, and a key
                // already in the field when it opens is checked right away.
                onBlur={() => homeserverCheck.check(homeserverPubky)}
                onFocus={() => {
                  if (homeserverPubky) homeserverCheck.check(homeserverPubky);
                }}
                onKeyDown={(event) => {
                  // Enter moves on to the code, as it would submit a one-line field.
                  if (event.key !== "Enter" || event.shiftKey) return;
                  event.preventDefault();
                  if (isPubkyPublicKey(homeserverPubky)) codeField.current?.focus();
                  else homeserverCheck.check(homeserverPubky);
                }}
              />
              {homeserverCheck.status === "invalid" && changingHomeserver ? (
                <FieldMessage error id="invite-homeserver-error">
                  A homeserver public key is 52 letters and digits. Check the key that came with
                  your invite.
                </FieldMessage>
              ) : homeserverCheck.status === "unreachable" && changingHomeserver ? (
                <FieldMessage error id="invite-homeserver-error">
                  Passport could not reach this homeserver. Check the key, or your connection.
                </FieldMessage>
              ) : (
                // One live hint, so "Checking…" and the answer are read out as they change.
                <FieldMessage
                  aria-live="polite"
                  className={cn(homeserverReachable && "flex items-center gap-1.5 text-brand")}
                  id="invite-homeserver-hint"
                >
                  {homeserverReachable ? (
                    <>
                      <CircleCheckIcon size={14} />
                      Homeserver found.
                    </>
                  ) : homeserverCheck.status === "checking" ? (
                    "Checking the homeserver…"
                  ) : (
                    "The key of the homeserver that gave you the invite."
                  )}
                </FieldMessage>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="invite-homeserver">Homeserver</Label>
                <Button onClick={() => setChangingHomeserver(true)} type="button" variant="link">
                  Change homeserver
                </Button>
              </div>
              {/* Read-only, like a detail in Manage identity: plain text, not a field-like box. */}
              <output
                className={cn(
                  "block text-sm font-medium leading-5 text-foreground",
                  BALANCED_KEY_CLASS,
                )}
                id="invite-homeserver"
              >
                <BalancedKeyText value={homeserverPubky} />
              </output>
            </div>
          )}
          <label htmlFor="invite-code" className="text-xl font-bold leading-7">
            Enter invite code
          </label>
          <Input
            id="invite-code"
            ref={codeField}
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
          {rejected && onChooseAnotherMethod ? (
            <Button className="self-start" onClick={onChooseAnotherMethod} variant="link">
              Verify another way
            </Button>
          ) : null}
        </OnboardingCard>
        {inviteOnly ? (
          <p className="text-sm leading-5 text-muted-foreground">
            Don’t have one? Invite codes come from whoever runs the homeserver you want to join.
          </p>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {/* Without the method list, the provider's terms stay in view here. */}
        {inviteOnly ? <ProviderTerms /> : null}
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
