import { type SubmitEvent, useState } from "react";

import { LOGGER } from "../../../../libs/logger/logger";
import { validateManualAuthorizationInput } from "../../../logic/authorization/entry/manualAuthorizationInput";
import { ArrowRightIcon, ClipboardPasteIcon } from "../../shared/actionIcons";
import { BackButton } from "../../shared/backButton";
import { PassportNavigation } from "../../shared/passportNavigation";
import { PassportScreen } from "../../shared/passportScreen";
import { Button } from "../../shared/primitives/button";
import { FieldMessage } from "../../shared/primitives/fieldMessage";
import { IconButton } from "../../shared/primitives/iconButton";
import { Input } from "../../shared/primitives/input";
import { Label } from "../../shared/primitives/label";
import { DisplayHeading, LeadText } from "../../shared/primitives/typography";

function ManualAuthorization({ onBack }: { onBack: () => void }) {
  const [authorization, setAuthorization] = useState("");
  const [error, setError] = useState<string>();

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthorization("");
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
      setAuthorization(value);
      setError(undefined);
    } catch {
      LOGGER.info("authorize.manual_entry.failed", {
        operation: "read_clipboard",
        code: "clipboard_unavailable",
      });
      setError("Clipboard access was blocked. Paste the link manually.");
    }
  };

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
              containerClassName="border-dashed bg-transparent"
              id="authorization-link"
              onChange={(event) => {
                setAuthorization(event.target.value);
                setError(undefined);
              }}
              placeholder="pubkyauth://"
              spellCheck={false}
              value={authorization}
            />
            {error ? <FieldMessage error id="authorization-link-error" role="alert">{error}</FieldMessage> : null}
          </div>
        </div>
        <PassportNavigation
          back={<BackButton onClick={onBack} />}
          className="pt-6"
          confirm={<Button className="w-full" disabled={authorization.trim().length === 0} size="lg" type="submit"><ArrowRightIcon />Continue</Button>}
        />
      </form>
    </PassportScreen>
  );
}

export { ManualAuthorization };
