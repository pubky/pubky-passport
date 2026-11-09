import Image from "next/image";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { BackButton } from "@/client/ui/shared/backButton";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { Notice } from "@/client/ui/shared/notice";
import { OnboardingScreen } from "@/client/ui/shared/onboardingScreen";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { TriangleAlertIcon } from "@/client/ui/shared/icons";
import { LegalConsent } from "@/client/ui/shared/legal/legalLinks";
import { ProviderTerms, usePassportProvider } from "@/client/ui/passportProviderConfiguration";
import { useHomegateAvailability } from "@/client/ui/homegateAvailability";
import { AvailabilityNotice, describeBlockedMethods } from "@/client/ui/verificationAvailability";
import { formatSats } from "./formatSats";

/**
 * Verify: how to prove the new account is a person's, as pubky.app draws it. From md three cards
 * (Small payment, Phone verification, Invite code), each with its illustration, name, one line on
 * what it costs and its button; below md one card titled "Pick verification method" with the
 * three buttons. A method this instance doesn't offer, or whose check failed, is left out; one
 * blocked in the person's country stays, dimmed: from md a red "Not available in your country"
 * banner covers its card, below md a red badge beside its button opens the same words with what
 * to do instead. An invite code is always offered.
 */
export function VerificationOptions({
  notice,
  onLightning,
  onSms,
  onInvite,
  onBack,
}: {
  /** Why the methods are shown again, such as a verification whose code was refused. */
  notice?: string | undefined;
  onLightning: () => void;
  onSms: () => void;
  onInvite: () => void;
  onBack: () => void;
}) {
  const provider = usePassportProvider();
  const { methods, retry } = useHomegateAvailability();
  const amountSat = methods.lightning.amountSat;
  const options = [
    {
      method: "lightning" as const,
      title: "Small payment",
      name: "Bitcoin payment",
      detail:
        provider.paymentDescription ??
        (amountSat ? `Pay ₿${formatSats(amountSat)} for secure verification` : "Pay with Bitcoin"),
      button: amountSat ? `Bitcoin payment (₿${formatSats(amountSat)})` : "Bitcoin payment",
      image: "/illustrations/verification-payment.png",
      icon: "/icons/wallet.svg",
      action: onLightning,
    },
    {
      method: "sms" as const,
      title: "Phone verification",
      name: "phone verification",
      detail: "Less private, but easy & free",
      button: "Phone number",
      image: "/illustrations/sms-verification.png",
      icon: "/icons/verification-phone.svg",
      action: onSms,
    },
    {
      method: "invite" as const,
      title: "Invite code",
      name: "an invite code",
      detail: "Have an invite code?",
      button: "Invite code",
      image: "/illustrations/invite.png",
      icon: "/icons/verification-invite.svg",
      action: onInvite,
    },
  ].filter(
    (option) =>
      option.method === "invite" ||
      (provider.verificationMethods.includes(option.method) &&
        // Methods still being probed keep their place so the layout does not shift under a tap.
        ["available", "blocked", "checking"].includes(methods[option.method].status)),
  );
  const statusOf = (method: (typeof options)[number]["method"]) =>
    method === "invite" ? "available" : methods[method].status;
  // Check again is for a check that failed; a method blocked in this country stays blocked. Once
  // offered it stays through the re-check, so focus is not lost.
  const [retryOffered, setRetryOffered] = useState(false);
  if (!retryOffered && (methods.sms.status === "unknown" || methods.lightning.status === "unknown"))
    setRetryOffered(true);
  const blockedSummary = describeBlockedMethods(
    options.filter((option) => statusOf(option.method) === "blocked").map((option) => option.name),
    options
      .filter((option) => statusOf(option.method) === "available")
      .map((option) => option.name),
  );
  return (
    <OnboardingScreen
      accent="not a robot."
      actions={
        <PassportNavigation back={<BackButton className="max-[30rem]:w-full" onClick={onBack} />} />
      }
      lead={
        <>
          New accounts are verified once to keep out spam.
          {provider.storageDescription ? ` ${provider.storageDescription}` : null}
        </>
      }
      title="Prove you’re"
    >
      {notice ? <Notice tone="info">{notice}</Notice> : null}
      <section
        aria-label="Verification methods"
        className={cn(
          "flex flex-col gap-3 rounded-lg bg-card p-6 md:grid md:gap-6 md:bg-transparent md:p-0",
          options.length === 3 && "md:grid-cols-3",
          options.length === 2 && "md:grid-cols-2",
        )}
      >
        <h2 className="mb-3 text-xl font-bold leading-7 md:hidden">Pick verification method</h2>
        {options.map((option) => (
          <VerificationMethod
            blocked={statusOf(option.method) === "blocked"}
            button={option.button}
            checking={statusOf(option.method) === "checking"}
            detail={option.detail}
            icon={option.icon}
            image={option.image}
            key={option.method}
            onChoose={option.action}
            title={option.title}
          />
        ))}
      </section>
      <AvailabilityNotice
        blockedSummary={blockedSummary}
        methods={[methods.sms, methods.lightning]}
        onRetry={retry}
        retry={retryOffered}
      />
      <LegalConsent />
      <ProviderTerms />
    </OnboardingScreen>
  );
}

function VerificationMethod({
  blocked,
  button,
  checking,
  detail,
  icon,
  image,
  onChoose,
  title,
}: {
  blocked: boolean;
  button: string;
  checking: boolean;
  detail: string;
  icon: string;
  image: string;
  onChoose: () => void;
  title: string;
}) {
  const detailId = useId();
  const blockedId = useId();
  return (
    <div className="relative min-w-0" role="group" aria-label={title}>
      <div
        className={cn(
          "flex min-w-0 flex-col md:h-full md:gap-6 md:rounded-lg md:bg-card md:p-8 lg:p-12",
          blocked && "md:pointer-events-none md:opacity-50 md:blur-[2.5px]",
        )}
      >
        <Image
          alt=""
          aria-hidden="true"
          className="mx-auto hidden size-40 shrink-0 object-contain md:block lg:size-48"
          height={192}
          src={image}
          width={192}
        />
        <div className="hidden flex-1 flex-col gap-3 md:flex">
          <h2 className="text-2xl font-bold leading-8">{title}</h2>
          <p
            className="text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground"
            id={detailId}
          >
            {detail}
          </p>
        </div>
        {/* Below md a blocked method's badge sits on its dimmed button's end, as on pubky.app. */}
        <div className="relative">
          <Button
            aria-describedby={cn(detailId, blocked && blockedId)}
            className="w-full"
            disabled={blocked}
            // Only the button shows the probe, so the card's text stays readable.
            loading={checking}
            onClick={onChoose}
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
            {button}
          </Button>
          {blocked ? (
            <div className="absolute right-2 top-1/2 z-10 -translate-y-1/2">
              <BlockedBadge descriptionId={blockedId} />
            </div>
          ) : null}
        </div>
      </div>
      {blocked ? (
        // From md the banner covers the card; below md the badge beside the button says it.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden items-center justify-center px-6 md:flex"
        >
          <p className="flex items-center gap-3 rounded-md bg-destructive-surface px-6 py-3 text-sm font-bold leading-5 text-destructive-foreground">
            <TriangleAlertIcon />
            Not available in your country
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Below md: a red warning badge beside a blocked method's dimmed button. Pressing it opens a small
 * popover with why and what to do instead; Escape, another press or a press elsewhere closes it.
 * The words also describe the dimmed button, so a screen reader hears them there.
 */
function BlockedBadge({ descriptionId }: { descriptionId: string }) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event.type === "pointerdown" && root.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="relative md:hidden" ref={root}>
      <p className="sr-only" id={descriptionId}>
        Not available in your country. Try a different verification method.
      </p>
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-label="Why is this not available?"
        className="flex size-11 items-center justify-center rounded-full bg-destructive-surface text-destructive-foreground"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <TriangleAlertIcon />
      </button>
      {open ? (
        <Popover id={popoverId}>
          <p className="font-bold text-foreground">Not available in your country</p>
          <p>Try a different verification method</p>
        </Popover>
      ) : null}
    </div>
  );
}

function Popover({ children, id }: { children: ReactNode; id: string }) {
  return (
    <div
      className="absolute right-0 top-full z-20 mt-2 w-64 rounded-md border border-border bg-popover p-4 text-sm leading-5 text-muted-foreground shadow-[0_24px_48px_rgba(5,5,10,0.6)]"
      id={id}
      role="status"
    >
      {children}
    </div>
  );
}
