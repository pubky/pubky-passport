import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useState } from "react";

import type { LightningInvoice } from "@/client/logic/homegate/HomegateVerificationClient";
import { BackButton } from "@/client/ui/shared/backButton";
import { copyToClipboard } from "@/client/ui/shared/copyToClipboard";
import { CopyIcon, RotateCcwIcon } from "@/client/ui/shared/icons";
import { Button, ButtonLink } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Label } from "@/client/ui/shared/primitives/label";
import { Notice } from "@/client/ui/shared/notice";
import { OnboardingCard } from "@/client/ui/shared/onboardingCard";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { useFocusWhenSettled } from "@/client/ui/shared/useFocusWhenSettled";
import { formatSats } from "./formatSats";
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
  // Checking and creating share `pending`; only the button that started the work shows it.
  const [busyAction, setBusyAction] = useState<"check" | "create" | null>(null);
  if (busyAction && !pending) setBusyAction(null);
  // A new invoice replaces the expired card and its focused button; the invoice is what's next.
  const invoiceHeading = useRef<HTMLHeadingElement>(null);
  useFocusWhenSettled(invoiceHeading, busyAction === "create", invoice !== null && !expired);
  const createInvoice = () => {
    setBusyAction("create");
    onCreateInvoice();
  };
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
              <Button
                disabled={pending}
                loading={busyAction === "create"}
                onClick={createInvoice}
                size="lg"
                variant="secondary"
              >
                <RotateCcwIcon />
                {busyAction === "create" ? "Creating invoice…" : "Create new invoice"}
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
                <h2
                  className="text-xl font-bold leading-7 outline-none"
                  ref={invoiceHeading}
                  tabIndex={-1}
                >
                  Bitcoin Lightning Payment
                </h2>
                {/* The unit is part of the text, so the amount never reads as bitcoin. */}
                <p className="text-5xl font-bold leading-none text-brand">
                  {formatSats(invoice.amountSat)}{" "}
                  <span className="text-2xl font-semibold text-secondary-foreground">sats</span>
                </p>
                <p className="text-base leading-6 text-secondary-foreground">
                  One-time payment to verify your new account.
                </p>
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <Spinner className="size-4" decorative />
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
            <Spinner decorative />
            Creating invoice…
          </p>
        ) : error ? null : (
          <p className="text-secondary-foreground">
            Your invoice could not be created. Please try again.
          </p>
        )}
        {error ? (
          <Notice tone="error">
            {error}
            {onUseInvite ? (
              <button
                className="w-fit cursor-pointer font-medium text-brand hover:underline pointer-coarse:min-h-11"
                type="button"
                onClick={onUseInvite}
              >
                Use an invite code
              </button>
            ) : null}
          </Notice>
        ) : null}
        {copyFailed && invoice && !expired ? (
          // A read-only field: labelled, focusable and easy to select on every device.
          <div className="flex flex-col gap-2">
            <Label htmlFor="lightning-invoice-text">Lightning invoice</Label>
            <textarea
              className="w-full resize-none break-all rounded-lg border border-dashed border-input bg-black/10 p-4 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              id="lightning-invoice-text"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              rows={4}
              value={invoice.bolt11Invoice}
            />
          </div>
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
                loading={busyAction === "check"}
                onClick={() => {
                  setBusyAction("check");
                  onCheckPayment(invoice);
                }}
                size="lg"
              >
                <RotateCcwIcon />
                {busyAction === "check" ? "Checking payment…" : "Check payment"}
              </Button>
            ) : (
              <Button className="w-full" onClick={() => void copyInvoice()} size="lg">
                <CopyIcon />
                Copy Invoice
              </Button>
            )
          ) : pending && busyAction !== "create" ? undefined : (
            // No retry while the first invoice is created; one that was pressed keeps focus.
            <Button
              className="w-full"
              loading={busyAction === "create"}
              onClick={createInvoice}
              size="lg"
            >
              <RotateCcwIcon />
              {busyAction === "create" ? "Creating invoice…" : "Try again"}
            </Button>
          )
        }
      />
    </SignupStep>
  );
}
