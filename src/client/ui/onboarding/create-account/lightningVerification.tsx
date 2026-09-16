import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

import type { LightningInvoice } from "@/client/logic/homegate/HomegateVerificationClient";
import { BackButton } from "@/client/ui/shared/backButton";
import { Button, ButtonLink } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";
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
}: {
  invoice: LightningInvoice | null;
  expired: boolean;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onCreateInvoice: () => void;
  onCheckPayment: (invoice: LightningInvoice) => void;
}) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  async function copyInvoice() {
    if (!invoice) return;
    try {
      await navigator.clipboard.writeText(invoice.bolt11Invoice);
      setCopyStatus("Invoice copied.");
    } catch {
      setCopyStatus("Could not copy automatically. Select and copy the invoice below.");
    }
  }
  return (
    <SignupStep
      title="Continue with"
      accent="Lightning."
      description="Pay a Lightning invoice to get your signup invite. Once confirmed, you’ll return to your app to create your account in Pubky Ring."
    >
      {invoice ? (
        expired ? (
          <p role="status">
            This invoice has expired. If you already paid, check the payment before creating another
            invoice.
          </p>
        ) : (
          <>
            <p className="text-center text-xl font-semibold">
              {invoice.amountSat.toLocaleString()} sats
            </p>
            <div className="mx-auto rounded-xl bg-white p-4">
              <QRCodeSVG
                value={`lightning:${invoice.bolt11Invoice.toUpperCase()}`}
                size={240}
                marginSize={4}
                title="Lightning payment invoice"
              />
            </div>
            <FieldMessage className="text-center">
              Expires at {new Date(invoice.expiresAt).toLocaleTimeString()}.
            </FieldMessage>
            <ButtonLink href={`lightning:${invoice.bolt11Invoice}`} size="lg">
              Open Lightning wallet
            </ButtonLink>
            <div className="flex flex-col gap-2">
              <Label htmlFor="lightning-invoice">Lightning invoice</Label>
              <Input
                id="lightning-invoice"
                readOnly
                value={invoice.bolt11Invoice}
                onFocus={(event) => event.target.select()}
              />
            </div>
            <Button variant="secondary" size="lg" onClick={() => void copyInvoice()}>
              Copy invoice
            </Button>
            {copyStatus ? <FieldMessage role="status">{copyStatus}</FieldMessage> : null}
            <p
              className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <Spinner /> Waiting for payment…
            </p>
          </>
        )
      ) : pending ? (
        <p className="flex items-center gap-2" role="status">
          <Spinner /> Creating invoice…
        </p>
      ) : null}
      {error ? <FieldMessage error>{error}</FieldMessage> : null}
      {expired && invoice ? (
        <Button disabled={pending} onClick={() => onCheckPayment(invoice)} size="lg">
          Check payment
        </Button>
      ) : null}
      {!invoice || expired ? (
        <Button disabled={pending} onClick={onCreateInvoice} size="lg" variant="secondary">
          {expired ? "Create new invoice" : "Try again"}
        </Button>
      ) : null}
      <BackButton onClick={onBack} />
    </SignupStep>
  );
}
