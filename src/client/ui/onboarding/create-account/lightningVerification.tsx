import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useState } from "react";

import type { LightningInvoice } from "@/client/logic/homegate/HomegateVerificationClient";
import { BackButton } from "@/client/ui/shared/backButton";
import { copyToClipboard } from "@/client/ui/shared/copyToClipboard";
import { CopyIcon, RotateCcwIcon } from "@/client/ui/shared/icons";
import { Button, ButtonLink } from "@/client/ui/shared/primitives/button";
import { Notice } from "@/client/ui/shared/notice";
import { OnboardingScreen } from "@/client/ui/shared/onboardingScreen";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { useFocusWhenSettled } from "@/client/ui/shared/useFocusWhenSettled";
import { formatSats } from "./formatSats";

/**
 * Pay: the Lightning invoice that verifies the account, as pubky.app draws it. A computer scans
 * its QR code ("Scan to pay."); a phone hands it to its wallet app with Pay Now in the card ("Tap
 * to pay."). Copy Invoice is the screen's other action. Passport watches the invoice and goes on
 * by itself once it is paid; an expired one can be checked or replaced.
 */
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
  const amount = invoice ? formatSats(invoice.amountSat) : "";
  return (
    <OnboardingScreen
      accent="pay."
      // Its actions lead on: pinned to a phone's window.
      stickyActions
      actions={
        <PassportNavigation
          back={<BackButton className="max-[30rem]:w-full" onClick={onBack} />}
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
                <Button
                  className="w-full"
                  onClick={() => void copyInvoice()}
                  size="lg"
                  variant="secondary"
                >
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
      }
      // The design's words in every state (frames 45785-544678, 544580): the card says the rest.
      lead={
        <>
          <span className="hidden md:inline">Scan the QR with your favorite wallet.</span>
          <span className="md:hidden">Pay with your favorite bitcoin wallet.</span>
        </>
      }
      title={
        <>
          <span className="hidden md:inline">Scan to</span>
          <span className="md:hidden">Tap to</span>
        </>
      }
      windowTitle="Pay"
    >
      <section
        aria-label="Bitcoin Lightning payment"
        className="flex min-w-0 flex-col gap-6 rounded-lg bg-card p-6 md:flex-row md:items-center md:gap-12 md:p-12"
      >
        {invoice ? (
          expired ? (
            <div className="flex flex-col gap-4">
              <h2 className="text-xl font-bold">Invoice expired</h2>
              <p className="text-secondary-foreground" role="status">
                If you already paid, check the payment before creating another invoice.
              </p>
              <Button
                className="w-full md:w-fit"
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
            <>
              <div className="hidden size-48 shrink-0 items-center justify-center rounded-lg bg-white p-2 md:flex">
                <QRCodeSVG
                  value={`lightning:${invoice.bolt11Invoice.toUpperCase()}`}
                  size={176}
                  marginSize={2}
                  level="H"
                  imageSettings={{
                    src: "/brand/bitcoin-logo.svg",
                    height: 36,
                    width: 36,
                    excavate: true,
                  }}
                  role="img"
                  aria-label="Lightning payment invoice"
                  title="Lightning payment invoice"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <h2
                  className="text-xl font-bold leading-7 outline-none md:text-2xl md:leading-8"
                  ref={invoiceHeading}
                  tabIndex={-1}
                >
                  Bitcoin Lightning Payment
                </h2>
                {/* ₿ stands for sats here, as on pubky.app; the unit is said in words too. */}
                <p
                  aria-label={`${amount} sats`}
                  className="text-5xl font-bold leading-none text-brand md:text-6xl"
                >
                  ₿ {amount}
                </p>
                <p className="text-base leading-6 text-secondary-foreground">
                  Please pay ₿{amount} to continue.
                </p>
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <Spinner className="size-4" decorative />
                  Waiting for payment · expires{" "}
                  {new Date(invoice.expiresAt).toLocaleTimeString([], { timeStyle: "short" })}
                </p>
                {/* A phone hands the invoice to its wallet app; a computer scans the code. */}
                <ButtonLink
                  className="mt-3 w-full md:hidden"
                  href={`lightning:${invoice.bolt11Invoice}`}
                  size="lg"
                >
                  <Image
                    alt=""
                    aria-hidden="true"
                    className="size-4"
                    height={16}
                    src="/icons/wallet.svg"
                    width={16}
                  />
                  Pay Now
                </ButtonLink>
              </div>
            </>
          )
        ) : pending ? (
          <p className="flex min-h-36 w-full items-center justify-center gap-2" role="status">
            <Spinner decorative />
            Creating invoice…
          </p>
        ) : error ? null : (
          <p className="text-secondary-foreground">
            Your invoice could not be created. Please try again.
          </p>
        )}
      </section>
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
        // The whole invoice as text: never cut off at a fixed height, and not a field-like box.
        // A labelled read-only textbox that selects all of itself when focused or tapped, so it
        // is easy to copy by hand on every device.
        <div className="flex flex-col gap-2">
          <p
            className="text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground"
            id="lightning-invoice-label"
          >
            Lightning invoice
          </p>
          <div
            aria-labelledby="lightning-invoice-label"
            aria-multiline="true"
            aria-readonly="true"
            className="select-all break-all rounded-sm font-mono text-sm leading-5 text-foreground"
            id="lightning-invoice-text"
            onFocus={(event) => window.getSelection()?.selectAllChildren(event.currentTarget)}
            role="textbox"
            tabIndex={0}
          >
            {invoice.bolt11Invoice}
          </div>
        </div>
      ) : null}
    </OnboardingScreen>
  );
}
