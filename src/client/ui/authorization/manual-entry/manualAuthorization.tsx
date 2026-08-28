import dynamic from "next/dynamic";
import { type SubmitEvent, useCallback, useRef, useState } from "react";

import { LOGGER } from "../../../../libs/logger/logger";
import { validateManualAuthorizationInput } from "../../../logic/authorization/entry/manualAuthorizationInput";
import { ArrowRightIcon, CameraIcon, ClipboardPasteIcon } from "../../shared/actionIcons";
import { BackButton } from "../../shared/backButton";
import { PassportNavigation } from "../../shared/passportNavigation";
import { PassportScreen } from "../../shared/passportScreen";
import { Button } from "../../shared/primitives/button";
import { FieldMessage } from "../../shared/primitives/fieldMessage";
import { IconButton } from "../../shared/primitives/iconButton";
import { Input } from "../../shared/primitives/input";
import { Label } from "../../shared/primitives/label";
import { DisplayHeading, LeadText } from "../../shared/primitives/typography";

const AuthorizationQrScanner = dynamic(
  () => import("./authorizationQrScanner").then((module) => module.AuthorizationQrScanner),
  { ssr: false },
);

function ManualAuthorization({ onBack }: { onBack: () => void }) {
  const authorizationInputRef = useRef<HTMLInputElement>(null);
  const [hasAuthorization, setHasAuthorization] = useState(false);
  const [error, setError] = useState<string>();
  const [scannerOpen, setScannerOpen] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const authorization = authorizationInputRef.current?.value ?? "";
    if (authorizationInputRef.current) authorizationInputRef.current.value = "";
    setHasAuthorization(false);
    const result = validateManualAuthorizationInput(authorization);
    if (result.status === "invalid") {
      setError("Enter a valid pubkyauth:// authorization link.");
      return;
    }

    try {
      History.prototype.replaceState.call(window.history, null, "", result.destination);
      window.location.reload();
    } catch {
      LOGGER.info("authorize.manual_entry.failed", {
        operation: "enter_authorization",
        code: "navigation_failed",
      });
      setError("Could not open the authorization request. Try again.");
    }
  };

  const paste = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (!authorizationInputRef.current) return;
      authorizationInputRef.current.value = value;
      setHasAuthorization(value.trim().length > 0);
      setError(undefined);
    } catch {
      LOGGER.info("authorize.manual_entry.failed", {
        operation: "read_clipboard",
        code: "clipboard_unavailable",
      });
      setError("Clipboard access was blocked. Paste the link manually.");
    }
  };

  const scan = useCallback((value: string) => {
    setScannerOpen(false);
    const result = validateManualAuthorizationInput(value);
    if (result.status === "invalid") {
      if (authorizationInputRef.current) authorizationInputRef.current.value = "";
      setHasAuthorization(false);
      setError("Scan a QR code containing a valid pubkyauth:// authorization link.");
      return;
    }

    if (authorizationInputRef.current) authorizationInputRef.current.value = value.trim();
    setHasAuthorization(true);
    setError(undefined);
  }, []);

  return (
    <PassportScreen>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
        <div className="flex flex-col gap-6">
          <DisplayHeading accent="a service." aria-label="Authorize a service.">
            Authorize
          </DisplayHeading>
          <LeadText>
            Paste or scan the authorization link from the app you want to connect.
          </LeadText>
          <div className="flex flex-col gap-2 pt-1">
            <Label htmlFor="authorization-link">Authorization link</Label>
            <Input
              action={
                <div className="flex items-center gap-1">
                  <IconButton
                    aria-label="Scan authorization QR code"
                    className="size-8 p-0"
                    onClick={() => setScannerOpen(true)}
                    type="button"
                    variant="ghost"
                  >
                    <CameraIcon />
                  </IconButton>
                  <IconButton
                    aria-label="Paste authorization link"
                    className="size-8 p-0"
                    onClick={() => void paste()}
                    type="button"
                    variant="ghost"
                  >
                    <ClipboardPasteIcon size={20} />
                  </IconButton>
                </div>
              }
              aria-describedby={error ? "authorization-link-error" : undefined}
              aria-invalid={Boolean(error)}
              autoCapitalize="none"
              autoComplete="off"
              containerClassName="border-dashed bg-transparent"
              id="authorization-link"
              onInput={(event) => {
                setHasAuthorization(event.currentTarget.value.trim().length > 0);
                setError(undefined);
              }}
              placeholder="pubkyauth://"
              ref={authorizationInputRef}
              spellCheck={false}
            />
            {error ? (
              <FieldMessage error id="authorization-link-error" role="alert">
                {error}
              </FieldMessage>
            ) : null}
          </div>
        </div>
        <PassportNavigation
          back={<BackButton onClick={onBack} />}
          className="pt-6"
          confirm={
            <Button className="w-full" disabled={!hasAuthorization} size="lg" type="submit">
              <ArrowRightIcon />
              Continue
            </Button>
          }
        />
      </form>
      {scannerOpen ? (
        <AuthorizationQrScanner onClose={() => setScannerOpen(false)} onScan={scan} />
      ) : null}
    </PassportScreen>
  );
}

export { ManualAuthorization };
