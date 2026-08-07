"use client";

import { type FormEvent, useCallback, useState } from "react";

import { enterAuthorization } from "../../../browser/authorization/browserManualAuthorization";
import { ArrowRightIcon, ClipboardPasteIcon, ScanIcon } from "../../shared/icons/actionIcons";
import { PassportScreen } from "../../shared/layout/passportScreen";
import { BackButton } from "../../shared/navigation/backButton";
import { Button } from "../../shared/primitives/button";
import { FieldMessage } from "../../shared/primitives/fieldMessage";
import { IconButton } from "../../shared/primitives/iconButton";
import { Input } from "../../shared/primitives/input";
import { Label } from "../../shared/primitives/label";
import { DisplayHeading, LeadText } from "../../shared/primitives/typography";
import { AuthorizationQrScannerDialog } from "./authorizationQrScannerDialog";

function ManualAuthorization({ onBack }: { onBack: () => void }) {
  const [authorization, setAuthorization] = useState("");
  const [error, setError] = useState<string>();
  const [scannerOpen, setScannerOpen] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = enterAuthorization(authorization);
    if (result === "invalid") setError("Enter a valid pubkyauth:// authorization link.");
    if (result === "navigation_failed") setError("Could not open the authorization request. Try again.");
  };

  const paste = async () => {
    try {
      const value = await navigator.clipboard.readText();
      setAuthorization(value);
      setError(undefined);
    } catch {
      setError("Clipboard access was blocked. Paste the link manually.");
    }
  };

  const scan = useCallback((value: string) => {
    setAuthorization(value);
    setError(undefined);
    setScannerOpen(false);
  }, []);

  return (
    <PassportScreen>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
        <div className="flex flex-col gap-6">
          <DisplayHeading accent="a service." aria-label="Authorize a service.">Authorize</DisplayHeading>
          <LeadText>Paste the authorization link from the app you want to connect.</LeadText>
          <div className="flex flex-col gap-2 pt-1">
            <Label htmlFor="authorization-link">Authorization link</Label>
            <Input
              action={<IconButton aria-label="Paste authorization link" className="size-6 p-0" onClick={() => void paste()} type="button" variant="ghost"><ClipboardPasteIcon size={20} /></IconButton>}
              aria-describedby={error ? "authorization-link-error" : undefined}
              aria-invalid={Boolean(error)}
              autoCapitalize="none"
              autoComplete="off"
              className="border-dashed bg-transparent"
              id="authorization-link"
              onChange={(event) => { setAuthorization(event.target.value); setError(undefined); }}
              placeholder="pubkyauth://"
              spellCheck={false}
              value={authorization}
            />
            {error ? <FieldMessage error id="authorization-link-error" role="alert">{error}</FieldMessage> : null}
          </div>
        </div>
        <div className="mt-auto flex flex-col gap-4 pt-6">
          <BackButton onClick={onBack} />
          <Button onClick={() => setScannerOpen(true)} size="lg" type="button" variant="secondary"><ScanIcon />Scan QR</Button>
          <Button disabled={!authorization.trim()} size="lg" type="submit"><ArrowRightIcon />Continue</Button>
        </div>
      </form>
      {scannerOpen ? <AuthorizationQrScannerDialog onClose={() => setScannerOpen(false)} onScan={scan} /> : null}
    </PassportScreen>
  );
}

export { ManualAuthorization };
