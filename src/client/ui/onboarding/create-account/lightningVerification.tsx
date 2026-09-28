import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

import type { LightningInvoice } from "@/client/logic/homegate/HomegateVerificationClient";
import { BackButton } from "@/client/ui/shared/backButton";
import { copyToClipboard } from "@/client/ui/shared/copyToClipboard";
import { CopyIcon, RotateCcwIcon } from "@/client/ui/shared/icons";
import { Button, ButtonLink } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { OnboardingCard } from "@/client/ui/shared/onboardingCard";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { SignupStep } from "./signupStep";

export function LightningVerification({
  invoice,
  expired,
  pending,
  error,
  onBack,
  onCreateInvoice,
  onCheckPayment,
  onUseInvite,
}: {
  invoice: LightningInvoice | null;
  expired: boolean;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onCreateInvoice: () => void;
  onCheckPayment: (invoice: LightningInvoice) => void;
  onUseInvite?: () => void;
}) {
  const [copyFailed, setCopyFailed] = useState(false);
  async function copyInvoice() {
    if (!invoice) return;
    const copied = await copyToClipboard(invoice.bolt11Invoice, {
      copied: "Invoice copied to clipboard",
      failed: "Could not copy invoice",
      failedDescription: "Select and copy the invoice manually.",
    });
    setCopyFailed(!copied);
  }
  return (
    <SignupStep
      title="Scan to"
      mobileTitle="Tap to"
      accent="Pay."
      description={
        <>
          <span className="sr-only">Pay the invoice with your favorite bitcoin wallet.</span>
          <span aria-hidden="true" className="hidden md:inline">
            Scan the QR code with your favorite wallet.
          </span>
          <span aria-hidden="true" className="md:hidden">
            Pay with your favorite bitcoin wallet.
          </span>
        </>
      }
    >
      <OnboardingCard>
        {invoice ? (
          expired ? (
            <div className="flex flex-col gap-4">
              <h2 className="text-xl font-bold">Invoice expired</h2>
              <p className="text-secondary-foreground" role="status">
                If you already paid, check the payment before creating another invoice.
              </p>
              <Button disabled={pending} onClick={onCreateInvoice} size="lg" variant="secondary">
                <RotateCcwIcon />
                Create new invoice
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-6 md:flex-row md:items-center">
              <div className="hidden size-44 shrink-0 items-center justify-center rounded-lg bg-white p-2 md:flex">
                <QRCodeSVG
                  value={`lightning:${invoice.bolt11Invoice.toUpperCase()}`}
                  size={160}
                  marginSize={2}
                  level="H"
                  imageSettings={{
                    src: "/brand/bitcoin-logo.svg",
                    height: 32,
                    width: 32,
                    excavate: true,
                  }}
                  role="img"
                  aria-label="Lightning payment invoice"
                  title="Lightning payment invoice"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <h2 className="text-xl font-bold leading-7">Bitcoin Lightning Payment</h2>
                <p
                  className="text-5xl font-bold leading-none text-brand"
                  aria-label={`${invoice.amountSat} sats`}
                >
                  ₿ {invoice.amountSat.toLocaleString()}
                </p>
                <p className="text-base leading-6 text-secondary-foreground">
                  Please pay {invoice.amountSat.toLocaleString()} sats to continue.
                </p>
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <Spinner className="size-4" />
                  Waiting for payment…
                </p>
                <FieldMessage>
                  Expires at {new Date(invoice.expiresAt).toLocaleTimeString()}.
                </FieldMessage>
                <ButtonLink
                  className="mt-3 w-full md:hidden"
                  href={`lightning:${invoice.bolt11Invoice}`}
                  size="lg"
                  variant="secondary"
                >
                  <Image
                    alt=""
                    aria-hidden="true"
                    src="/icons/wallet.svg"
                    width={16}
                    height={16}
                    className="size-4"
                  />
                  Pay Now
                </ButtonLink>
              </div>
            </div>
          )
        ) : pending ? (
          <p className="flex min-h-36 items-center justify-center gap-2" role="status">
            <Spinner />
            Creating invoice…
          </p>
        ) : (
          <p className="text-secondary-foreground">
            Your invoice could not be created. Please try again.
          </p>
        )}
        {error ? <FieldMessage error>{error}</FieldMessage> : null}
        {error && onUseInvite ? (
          <button
            className="w-fit cursor-pointer text-sm text-brand hover:underline"
            type="button"
            onClick={onUseInvite}
          >
            Use an invite code
          </button>
        ) : null}
        {copyFailed && invoice && !expired ? (
          <p
            className="select-all break-all rounded-lg border border-dashed border-input p-4 text-sm"
            aria-label="Lightning invoice"
          >
            {invoice.bolt11Invoice}
          </p>
        ) : null}
      </OnboardingCard>
      <PassportNavigation
        className="mt-auto md:mt-0"
        back={<BackButton onClick={onBack} />}
        confirm={
          invoice ? (
            expired ? (
              <Button
                className="w-full"
                disabled={pending}
                onClick={() => onCheckPayment(invoice)}
                size="lg"
              >
                <RotateCcwIcon />
                Check payment
              </Button>
            ) : (
              <Button className="w-full" onClick={() => void copyInvoice()} size="lg">
                <CopyIcon />
                Copy Invoice
              </Button>
            )
          ) : (
            <Button className="w-full" disabled={pending} onClick={onCreateInvoice} size="lg">
              <RotateCcwIcon />
              Try again
            </Button>
          )
        }
      />
    </SignupStep>
  );
}
