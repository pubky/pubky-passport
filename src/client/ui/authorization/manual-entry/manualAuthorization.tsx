import dynamic from "next/dynamic";
import { type SubmitEvent, useCallback, useRef, useState } from "react";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { validateManualAuthorizationInput } from "@/client/logic/authorization/entry/manualAuthorizationInput";
import { ArrowRightIcon, CameraIcon, ClipboardPasteIcon, ScanIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { IconButton } from "@/client/ui/shared/primitives/iconButton";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

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
    } catch (e) {
      LOGGER.info("authorize.manual_entry.failed", {
        operation: "enter_authorization",
        code: "navigation_failed",
        ...safeErrorLogFields(e),
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
    } catch (e) {
      LOGGER.info("authorize.manual_entry.failed", {
        operation: "read_clipboard",
        code: "clipboard_unavailable",
        ...safeErrorLogFields(e),
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
        <div className="flex flex-col gap-6 md:gap-8">
          <div className="flex flex-col gap-6 md:gap-3">
            <DisplayHeading accent="a service." aria-label="Authorize a service.">
              Authorize
            </DisplayHeading>
            <LeadText>Paste the authorization link from the app you want to connect.</LeadText>
          </div>
          <div className="flex flex-col gap-2">
            <Label className="leading-5 md:leading-4" htmlFor="authorization-link">
              Authorization link
            </Label>
            <Input
              action={
                <div className="flex items-center gap-1">
                  <IconButton
                    aria-label="Scan authorization QR code"
                    className="hidden size-8 p-0 md:inline-flex"
                    onClick={() => setScannerOpen(true)}
                    type="button"
                    variant="ghost"
                  >
                    <CameraIcon size={20} />
                  </IconButton>
                  <IconButton
                    aria-label="Paste authorization link"
                    className="size-6 p-0 md:size-8"
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
              containerClassName="h-14 border-dashed bg-transparent md:h-15"
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
          className="mt-auto md:mt-0 md:pt-6"
          confirm={
            <div className="flex flex-col gap-4">
              <Button
                className="w-full md:hidden"
                onClick={() => setScannerOpen(true)}
                size="lg"
                type="button"
                variant="secondary"
              >
                <ScanIcon />
                Scan QR
              </Button>
              <Button className="w-full" disabled={!hasAuthorization} size="lg" type="submit">
                <ArrowRightIcon />
                Continue
              </Button>
            </div>
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
