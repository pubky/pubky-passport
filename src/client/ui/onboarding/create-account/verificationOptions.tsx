import Image from "next/image";
import { useId } from "react";
import { BackButton } from "@/client/ui/shared/backButton";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { ProviderTerms, usePassportProvider } from "@/client/ui/passportProviderConfiguration";
import { useHomegateAvailability } from "@/client/ui/homegateAvailability";
import {
  AvailabilityCard,
  AvailabilityNotice,
  describeBlockedMethods,
} from "@/client/ui/verificationAvailability";
import { formatSats } from "./formatSats";

export function VerificationOptions({
  onLightning,
  onSms,
  onInvite,
  onBack,
}: {
  onLightning: () => void;
  onSms: () => void;
  onInvite: () => void;
  onBack: () => void;
}) {
  const provider = usePassportProvider();
  const { methods, retry } = useHomegateAvailability();
  const detailId = useId();
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
      detail: "Verify with your phone number",
      button: "Continue with SMS",
      image: "/illustrations/sms-verification.png",
      icon: "/icons/verification-phone.svg",
      action: onSms,
    },
    {
      method: "invite" as const,
      title: "Invite code",
      name: "an invite code",
      detail: "Use an invite from a homeserver",
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
        <LeadText>
          {provider.storageDescription ?? "Choose how to verify and create your Pubky account."}
        </LeadText>
        <p className="text-sm leading-5 text-muted-foreground">
          New accounts are verified once to keep out spam.
        </p>
      </div>
      <section
        aria-label="Verification methods"
        className={`grid gap-5 rounded-lg bg-card p-6 lg:gap-6 lg:bg-transparent lg:p-0 ${options.length === 3 ? "lg:grid-cols-3" : options.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-1"}`}
      >
        <h2 className="mb-3 text-xl font-bold lg:hidden">Pick verification method</h2>
        {options.map((option) => {
          const status = statusOf(option.method);
          const blocked = status === "blocked";
          const checking = status === "checking";
          return (
            <AvailabilityCard
              key={option.method}
              blocked={blocked}
              label={option.title}
              className={cn(
                "flex min-w-0 flex-col gap-2 lg:gap-6 lg:rounded-lg lg:bg-card",
                lone ? "lg:flex-row lg:items-center lg:gap-8 lg:p-8" : "lg:p-12",
              )}
            >
              <Image
                alt=""
                aria-hidden="true"
                src={option.image}
                width={192}
                height={192}
                className={cn(
                  "hidden shrink-0 object-contain lg:block",
                  lone ? "size-36" : "mx-auto size-48",
                )}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2 lg:gap-6">
                <div className="hidden flex-1 space-y-3 lg:block">
                  <h2 className="text-2xl font-bold leading-8">{option.title}</h2>
                  <p
                    className={`text-xs uppercase leading-4 tracking-[0.1em] ${blocked ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {option.detail}
                  </p>
                </div>
                <Button
                  aria-describedby={`${detailId}-${option.method}`}
                  className="w-full"
                  size="lg"
                  variant="secondary"
                  disabled={blocked}
                  // Only the button shows the probe, so the card's text stays readable.
                  loading={checking}
                  onClick={option.action}
                >
                  <Image
                    alt=""
                    data-slot="icon"
                    src={option.icon}
                    width={16}
                    height={16}
                    className="size-4 shrink-0"
                  />{" "}
                  {option.button}
                </Button>
                {/* Below lg the cards collapse to buttons; the price and terms stay under each. A
                    blocked card is dimmed, so its line takes the full text colour to stay legible. */}
                <p
                  className={`text-sm leading-5 lg:hidden ${blocked ? "text-foreground" : "text-muted-foreground"}`}
                  id={`${detailId}-${option.method}`}
                >
                  {option.detail}
                </p>
              </div>
            </AvailabilityCard>
          );
        })}
      </section>
      <AvailabilityNotice
        blockedSummary={blockedSummary}
        methods={[methods.sms, methods.lightning]}
        onRetry={retry}
      />
      <ProviderTerms />
      <BackButton onClick={onBack} />
    </PassportScreen>
  );
}
