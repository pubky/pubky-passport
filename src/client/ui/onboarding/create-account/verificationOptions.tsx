import Image from "next/image";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { ProviderTerms, usePassportProvider } from "@/client/ui/passportProviderConfiguration";
import { useHomegateAvailability } from "@/client/ui/homegateAvailability";
import { AvailabilityCard, AvailabilityNotice } from "@/client/ui/verificationAvailability";

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
  const options = [
    {
      method: "lightning" as const,
      title: "Lightning payment",
      detail:
        provider.paymentDescription ??
        (methods.lightning.amountSat
          ? `Verify with ${methods.lightning.amountSat.toLocaleString("en-US")} sats`
          : "Verify with a Lightning payment"),
      button: "Continue with Lightning",
      image: "/illustrations/verification-payment.png",
      icon: "/icons/wallet.svg",
      action: onLightning,
    },
    {
      method: "sms" as const,
      title: "Phone verification",
      detail: "Verify with your phone number",
      button: "Continue with SMS",
      image: "/illustrations/sms-verification.png",
      icon: "/icons/verification-phone.svg",
      action: onSms,
    },
    {
      method: "invite" as const,
      title: "Invite code",
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
  return (
    <PassportScreen width="wide" className="gap-6">
      <div className="space-y-3">
        <DisplayHeading accent="account." className="[&>span]:inline">
          Create your{" "}
        </DisplayHeading>
        <LeadText>
          {provider.storageDescription ?? "Choose how to verify and create your Pubky account."}
        </LeadText>
      </div>
      <section
        aria-label="Verification methods"
        className={`grid gap-3 rounded-lg bg-card p-6 lg:gap-6 lg:bg-transparent lg:p-0 ${options.length === 3 ? "lg:grid-cols-3" : options.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-1"}`}
      >
        <h2 className="mb-3 text-xl font-bold lg:hidden">Pick verification method</h2>
        {options.map((option) => {
          const status = option.method === "invite" ? "available" : methods[option.method].status;
          const blocked = status === "blocked";
          const checking = status === "checking";
          return (
            <AvailabilityCard
              key={option.method}
              blocked={blocked}
              label={option.title}
              className={`flex min-w-0 flex-col gap-6 lg:rounded-lg lg:bg-card lg:p-12 ${checking ? "opacity-50" : ""}`}
            >
              <Image
                alt=""
                aria-hidden="true"
                src={option.image}
                width={192}
                height={192}
                className="mx-auto hidden size-48 object-contain lg:block"
              />
              <div className="hidden flex-1 space-y-3 lg:block">
                <h2 className="text-2xl font-bold leading-8">{option.title}</h2>
                <p
                  className={`text-xs uppercase leading-4 tracking-[0.1em] ${blocked ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {option.detail}
                </p>
              </div>
              <Button
                className="w-full whitespace-normal"
                size="lg"
                variant="secondary"
                disabled={blocked || checking}
                aria-busy={checking || undefined}
                onClick={option.action}
              >
                <Image
                  alt=""
                  src={option.icon}
                  width={16}
                  height={16}
                  className="size-4 shrink-0"
                />{" "}
                {option.button}
              </Button>
            </AvailabilityCard>
          );
        })}
      </section>
      <AvailabilityNotice methods={[methods.sms, methods.lightning]} onRetry={retry} />
      <ProviderTerms />
      <BackButton onClick={onBack} />
    </PassportScreen>
  );
}
