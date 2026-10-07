import dynamic from "next/dynamic";
import { type SubmitEvent, useCallback, useLayoutEffect, useRef, useState } from "react";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { validateManualAuthorizationInput } from "@/client/logic/authorization/entry/manualAuthorizationInput";
import { markAuthorizeFromIdentity } from "@/client/logic/universal-signer/authorizeFromIdentity";
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

function ManualAuthorization({
  identityPublicKeyZ32,
  onBack,
}: {
  /** The identity whose overview opened this screen: the request opens on its review. */
  identityPublicKeyZ32?: string | undefined;
  onBack: () => void;
}) {
  const authorizationInputRef = useRef<HTMLInputElement>(null);
  const [hasAuthorization, setHasAuthorization] = useState(false);
  const [error, setError] = useState<string>();
  const [scannerOpen, setScannerOpen] = useState(false);
  // A rejected link empties the field, which disables Continue (or closes the scanner): focus
  // returns to the field after that commit, so it is not lost to the page.
  const [focusRequest, setFocusRequest] = useState(0);
  const refocusInput = () => setFocusRequest((request) => request + 1);
  useLayoutEffect(() => {
    if (focusRequest > 0) authorizationInputRef.current?.focus();
  }, [focusRequest]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const authorization = authorizationInputRef.current?.value ?? "";
    if (authorizationInputRef.current) authorizationInputRef.current.value = "";
    setHasAuthorization(false);
    const result = validateManualAuthorizationInput(authorization);
    if (result.status === "invalid") {
      setError("Enter a valid pubkyauth:// authorization link.");
      refocusInput();
      return;
    }

    try {
      History.prototype.replaceState.call(window.history, null, "", result.destination);
      // The reloaded page opens the request on the review of the identity Authorize was pressed on.
      if (identityPublicKeyZ32 !== undefined) markAuthorizeFromIdentity(identityPublicKeyZ32);
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
      setFocusRequest((request) => request + 1);
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
            <DisplayHeading accent="an app." aria-label="Authorize an app.">
              Authorize
            </DisplayHeading>
            <LeadText>
              Paste or scan the authorization request from the app you want to connect.
            </LeadText>
          </div>
          {/* A link's field, as wide as account creation's fields, not the whole track. */}
          <div className="flex flex-col gap-2 md:max-w-xl">
            <Label className="leading-5 md:leading-4" htmlFor="authorization-link">
              Authorization link
            </Label>
            <Input
              action={
                <div className="flex shrink-0 items-center gap-1">
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
          // The padding keeps the field and its error clear of Back when the page is taller than
          // the window, where `mt-auto` gives no room.
          className="mt-auto pt-6 md:mt-0"
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
                Scan QR code
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
        <AuthorizationQrScanner
          onClose={() => setScannerOpen(false)}
          onPasteInstead={() => {
            setScannerOpen(false);
            refocusInput();
          }}
          onScan={scan}
        />
      ) : null}
    </PassportScreen>
  );
}

export { ManualAuthorization };
