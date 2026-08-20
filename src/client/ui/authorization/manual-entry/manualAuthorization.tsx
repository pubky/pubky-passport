"use client";

import { type SubmitEvent, useState } from "react";

import { submitManualAuthorizationInput } from "../../../logic/authorization/entry/manualAuthorizationInput";
import { ArrowRightIcon, ClipboardPasteIcon } from "../../shared/actionIcons";
import { BackButton } from "../../shared/backButton";
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
    const result = submitManualAuthorizationInput(authorization);
    switch (result) {
      case "invalid":
        setError("Enter a valid pubkyauth:// authorization link.");
        return;
      case "navigation_failed":
        setError("Could not open the authorization request. Try again.");
        return;
      case "navigating":
        return;
    }
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
        <div className="mt-auto flex flex-col gap-4 pt-6">
          <BackButton onClick={onBack} />
          <Button disabled={authorization.trim().length === 0} size="lg" type="submit"><ArrowRightIcon />Continue</Button>
        </div>
      </form>
    </PassportScreen>
  );
}

export { ManualAuthorization };
