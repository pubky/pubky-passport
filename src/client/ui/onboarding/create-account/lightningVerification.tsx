import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

import type { LightningInvoice } from "@/client/logic/homegate/HomegateVerificationClient";
import { BackButton } from "@/client/ui/shared/backButton";
import { Button, ButtonLink } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { DetailField } from "@/client/ui/shared/detailField";
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
}: {
  invoice: LightningInvoice | null;
  expired: boolean;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onCreateInvoice: () => void;
  onCheckPayment: (invoice: LightningInvoice) => void;
}) {
  async function copyInvoice() {
    if (!invoice) return;
    try {
      await navigator.clipboard.writeText(invoice.bolt11Invoice);
      toast.info("Invoice copied to clipboard");
    } catch {
      toast.info("Could not copy invoice", {
        description: "Select and copy the invoice manually.",
      });
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
            <p
              className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <Spinner /> Waiting for payment…
            </p>
            <FieldMessage className="text-center">
              Expires at {new Date(invoice.expiresAt).toLocaleTimeString()}.
            </FieldMessage>
            <DetailField
              copyable
              label="Lightning invoice"
              onCopy={() => void copyInvoice()}
              value={invoice.bolt11Invoice}
            />
          </>
        )
      ) : pending ? (
        <p className="flex items-center gap-2" role="status">
          <Spinner /> Creating invoice…
        </p>
      ) : null}
      {error ? <FieldMessage error>{error}</FieldMessage> : null}
      {expired ? (
        <Button disabled={pending} onClick={onCreateInvoice} size="lg" variant="secondary">
          Create new invoice
        </Button>
      ) : null}
      <PassportNavigation
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
                Check payment
              </Button>
            ) : (
              <ButtonLink className="w-full" href={`lightning:${invoice.bolt11Invoice}`} size="lg">
                Open Lightning wallet
              </ButtonLink>
            )
          ) : (
            <Button className="w-full" disabled={pending} onClick={onCreateInvoice} size="lg">
              Try again
            </Button>
          )
        }
      />
    </SignupStep>
  );
}
