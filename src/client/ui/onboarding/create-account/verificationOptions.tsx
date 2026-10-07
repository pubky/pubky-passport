import Image from "next/image";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { BackButton } from "@/client/ui/shared/backButton";
import { TriangleAlertIcon } from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { Notice } from "@/client/ui/shared/notice";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { ProviderTerms, usePassportProvider } from "@/client/ui/passportProviderConfiguration";
import { useHomegateAvailability } from "@/client/ui/homegateAvailability";
import { AvailabilityNotice, describeBlockedMethods } from "@/client/ui/verificationAvailability";
import { formatSats } from "./formatSats";

/**
 * Create your account: how to prove the new account is a person's. From lg one card per method
 * (illustration, title, Lightning's price, button); below lg one card titled "Pick verification
 * method" with the buttons. A method this instance doesn't offer, or whose check failed, is left
 * out; one blocked in the person's country stays, dimmed: from lg a red "Not available in your
 * country" banner covers its card, below lg a red badge beside its button opens the same words
 * with what to do instead. An invite code is always offered.
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
  const options = [
    {
      method: "lightning" as const,
      title: "Lightning payment",
      name: "Lightning",
      detail:
        provider.paymentDescription ??
        (methods.lightning.amountSat
          ? `Verify with ${formatSats(methods.lightning.amountSat)} sats`
          : "Verify with a Lightning payment"),
      button: "Continue with Lightning",
      image: "/illustrations/verification-payment.png",
      icon: "/icons/wallet.svg",
      action: onLightning,
    },
    {
      method: "sms" as const,
      title: "Phone verification",
      name: "SMS",
      detail: undefined,
      button: "Continue with SMS",
      image: "/illustrations/sms-verification.png",
      icon: "/icons/verification-phone.svg",
      action: onSms,
    },
    {
      method: "invite" as const,
      title: "Invite code",
      name: "an invite code",
      detail: undefined,
      button: "Enter invite manually",
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
  // A lone method (the others failed their check, or an invite-only provider) keeps the step
  // column, as one card with its illustration beside the text, instead of stretching across the
  // page. Two methods share an 800px column, so their cards stay card-shaped.
  const lone = options.length === 1;
  return (
    <PassportScreen
      width={lone ? "compact" : "wide"}
      className={cn("gap-6", options.length === 2 && "lg:max-w-[880px]")}
    >
      <div className="space-y-3">
        <DisplayHeading accent="account." className="[&>span]:inline">
          Create your{" "}
        </DisplayHeading>
        {/* The lead says what to do here; what the provider offers is a detail beneath it. */}
        <LeadText>Choose how to verify and create your Pubky account.</LeadText>
        <p className="text-sm leading-5 text-muted-foreground">
          New accounts are verified once to keep out spam.
          {provider.storageDescription ? ` ${provider.storageDescription}` : null}
        </p>
      </div>
      {notice ? <Notice tone="info">{notice}</Notice> : null}
      <section
        aria-label="Verification methods"
        className={`grid gap-5 rounded-lg bg-card p-6 lg:gap-6 lg:bg-transparent lg:p-0 ${options.length === 3 ? "lg:grid-cols-3" : options.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-1"}`}
      >
        <h2 className="mb-3 text-xl font-bold lg:hidden">Pick verification method</h2>
        {options.map((option) => (
          <VerificationMethod
            blocked={statusOf(option.method) === "blocked"}
            button={option.button}
            checking={statusOf(option.method) === "checking"}
            detail={option.detail}
            icon={option.icon}
            image={option.image}
            key={option.method}
            lone={lone}
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
      <ProviderTerms />
      <BackButton onClick={onBack} />
    </PassportScreen>
  );
}

function VerificationMethod({
  blocked,
  button,
  checking,
  detail,
  icon,
  image,
  lone,
  onChoose,
  title,
}: {
  blocked: boolean;
  button: string;
  checking: boolean;
  detail: string | undefined;
  icon: string;
  image: string;
  /** The only method: one card with its illustration beside the text. */
  lone: boolean;
  onChoose: () => void;
  title: string;
}) {
  const detailId = useId();
  const blockedId = useId();
  return (
    <div className="relative min-w-0" role="group" aria-label={title}>
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2 lg:h-full lg:gap-6 lg:rounded-lg lg:bg-card",
          lone ? "lg:flex-row lg:items-center lg:gap-8 lg:p-8" : "lg:p-12",
          blocked && "lg:pointer-events-none lg:opacity-50 lg:blur-[2.5px]",
        )}
      >
        <Image
          alt=""
          aria-hidden="true"
          src={image}
          width={192}
          height={192}
          className={cn(
            "hidden shrink-0 object-contain lg:block",
            lone ? "size-36" : "mx-auto size-48",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 lg:gap-6">
          <div className="hidden flex-1 space-y-3 lg:block">
            <h2 className="text-2xl font-bold leading-8">{title}</h2>
            {/* A blocked card is dimmed, so its line takes the full text colour to stay legible. */}
            {detail ? (
              <p
                className={`text-xs uppercase leading-4 tracking-[0.1em] ${blocked ? "text-foreground" : "text-muted-foreground"}`}
              >
                {detail}
              </p>
            ) : null}
          </div>
          {/* Below lg a blocked method's badge sits on its dimmed button's end. */}
          <div className="relative">
            <Button
              aria-describedby={cn(detail && detailId, blocked && blockedId) || undefined}
              className="w-full"
              size="lg"
              variant="secondary"
              disabled={blocked}
              // Only the button shows the probe, so the card's text stays readable.
              loading={checking}
              onClick={onChoose}
            >
              <Image
                alt=""
                data-slot="icon"
                src={icon}
                width={16}
                height={16}
                className="size-4 shrink-0"
              />{" "}
              {button}
            </Button>
            {blocked ? (
              <div className="absolute right-2 top-1/2 z-10 -translate-y-1/2">
                <BlockedBadge descriptionId={blockedId} />
              </div>
            ) : null}
          </div>
          {/* Below lg the cards collapse to buttons; the price and terms stay under each. Only a
              blocked button is dimmed there, so its line keeps the muted colour. */}
          {detail ? (
            <p className="text-sm leading-5 text-muted-foreground lg:hidden" id={detailId}>
              {detail}
            </p>
          ) : null}
        </div>
      </div>
      {blocked ? (
        // From lg the banner covers the card; below lg the badge beside the button says it.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden items-center justify-center px-6 lg:flex"
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
 * Below lg: a red warning badge beside a blocked method's dimmed button. Pressing it opens a small
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
    <div className="relative lg:hidden" ref={root}>
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
