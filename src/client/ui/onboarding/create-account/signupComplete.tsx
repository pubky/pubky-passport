import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

import type { HomeserverSignupDetails } from "@/client/logic/homegate/homegateSignup";
import { ringSignupUrl } from "@/client/logic/signup/ringSignup";
import {
  handoffSignupCompletion,
  signupCallbackUrl,
} from "@/client/logic/signup/signupCompletionHandoff";
import type { SignupRequest } from "@/client/logic/signup/signupRequest";
import { BackButton } from "@/client/ui/shared/backButton";
import { PubkyRingLogo } from "@/client/ui/shared/brand/pubkyRingLogo";
import { PubkyRingStoreBadges } from "@/client/ui/shared/brand/pubkyRingStoreBadges";
import { MobilePassportFooter } from "@/client/ui/shared/mobilePassportFooter";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button, ButtonLink } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

export function SignupComplete({
  request,
  invite,
}: {
  request: SignupRequest | null;
  invite: HomeserverSignupDetails;
}) {
  const [step, setStep] = useState<"scan" | "install" | "returning">("scan");
  const [showQr, setShowQr] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const url = ringSignupUrl(invite);

  useEffect(() => {
    if (step !== "returning" || !request) return;
    const controller = new AbortController();
    void handoffSignupCompletion(window, request, controller.signal).then(
      (status) => {
        if (!controller.signal.aborted && status === "unavailable") setUnavailable(true);
      },
      () => {
        if (!controller.signal.aborted) setUnavailable(true);
      },
    );
    return () => controller.abort();
  }, [step, request]);

  const installing = step === "install";
  return (
    <PassportScreen className="gap-6 md:max-w-[1200px] md:gap-8 md:px-6">
      <header className="flex flex-col gap-3">
        <DisplayHeading accent={installing ? "Pubky Ring." : "QR Code."}>
          {installing ? "Install" : "Scan"}
        </DisplayHeading>
        <LeadText>
          {installing
            ? "Pubky Ring is a keychain for your identity keys in the Pubky ecosystem."
            : "Open Pubky Ring, tap ‘Add Pubky’, then ‘Scan signup QR’ to create your account."}
        </LeadText>
      </header>

      {installing ? (
        <section className="flex flex-col items-center gap-6 rounded-md bg-card p-6 md:flex-row md:p-12">
          <Image
            alt=""
            src="/illustrations/keychain.png"
            width={192}
            height={192}
            className="hidden size-48 lg:block"
          />
          <div className="flex flex-col gap-4">
            <PubkyRingLogo />
            <p className="text-base font-medium text-muted-foreground">
              Download and install the mobile app. Then continue to the next step.
            </p>
            <PubkyRingStoreBadges />
          </div>
        </section>
      ) : (
        <>
          {/* Layout and illustration from pubky.app's Scan and BalancedQrCard components. */}
          <section
            className={`${showQr ? "flex" : "hidden md:flex [@media(pointer:fine)]:flex"} w-full items-center justify-center gap-12 overflow-hidden rounded-md bg-card p-6 lg:p-12`}
          >
            <Image
              alt="Pubky Ring phone scanning a QR code"
              src="/illustrations/ring-scan.webp"
              width={192}
              height={192}
              className="hidden size-48 shrink-0 lg:block"
            />
            <div className="flex size-48 shrink-0 items-center justify-center rounded-md bg-white p-2">
              <QRCodeSVG
                aria-label="Pubky Ring signup QR code"
                role="img"
                value={url}
                size={176}
                level="H"
                marginSize={4}
                imageSettings={{
                  src: "/brand/ring-qr-logo.svg",
                  height: 40,
                  width: 40,
                  excavate: true,
                }}
              />
            </div>
            <div aria-hidden="true" className="hidden w-48 shrink-0 lg:block" />
          </section>
          <section className="flex flex-col items-center gap-6 rounded-md bg-card p-6 md:hidden [@media(pointer:fine)]:hidden">
            <PubkyRingLogo />
            <ButtonLink className="w-full" href={url} size="lg">
              Open Pubky Ring
            </ButtonLink>
            {!showQr ? (
              <Button variant="secondary" className="w-full" onClick={() => setShowQr(true)}>
                Show signup QR
              </Button>
            ) : null}
          </section>
        </>
      )}

      <p className="text-sm text-muted-foreground">
        Use{" "}
        <a
          className="text-brand underline underline-offset-2"
          href="https://pubkyring.app/"
          target="_blank"
          rel="noreferrer"
        >
          Pubky Ring
        </a>{" "}
        or any other{" "}
        <a
          className="text-brand underline underline-offset-2"
          href="https://pubky.org"
          target="_blank"
          rel="noreferrer"
        >
          Pubky Core
        </a>
        –powered keychain.
      </p>
      {!installing ? (
        <div className="flex flex-col gap-3">
          <button
            className="w-fit cursor-pointer text-sm text-brand underline"
            onClick={() => setStep("install")}
          >
            Need to install Pubky Ring?
          </button>
          {request ? (
            <FieldMessage>
              Finish creating your account in Ring, then continue to {request.clientOrigin} to sign
              in.
            </FieldMessage>
          ) : null}
        </div>
      ) : null}
      {step === "returning" ? <p role="status">Returning to your app to sign in…</p> : null}
      {unavailable && request ? (
        <FieldMessage error>
          We couldn’t return automatically.{" "}
          <a className="underline" href={signupCallbackUrl(request)} referrerPolicy="no-referrer">
            Return to app
          </a>
          .
        </FieldMessage>
      ) : null}
      <PassportNavigation
        back={
          <BackButton
            disabled={step === "returning"}
            onClick={() => setStep(installing ? "scan" : "install")}
          />
        }
        confirm={
          installing ? (
            <Button className="w-full" size="lg" onClick={() => setStep("scan")}>
              Continue with Pubky Ring
            </Button>
          ) : request ? (
            <Button
              className="w-full"
              size="lg"
              disabled={step === "returning"}
              onClick={() => setStep("returning")}
            >
              Continue to sign in
            </Button>
          ) : undefined
        }
      />
      <MobilePassportFooter />
    </PassportScreen>
  );
}
