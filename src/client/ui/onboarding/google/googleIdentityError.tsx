"use client";

import type { GoogleIdentityFlowError } from "../../../logic/identity/passportIdentityController";
import { RotateCcwIcon } from "../../shared/icons/actionIcons";
import { PassportScreen } from "../../shared/layout/passportScreen";
import { BackButton } from "../../shared/navigation/backButton";
import { Button } from "../../shared/primitives/button";
import { DisplayHeading, LeadText } from "../../shared/primitives/typography";

function GoogleIdentityError({ error, onBack, onResume, onTryAgain }: {
  error: GoogleIdentityFlowError;
  onBack: () => void;
  onResume: (() => void) | null;
  onTryAgain: () => void;
}) {
  return (
    <PassportScreen className="gap-6">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="interrupted." aria-label="Setup interrupted.">Setup</DisplayHeading>
        <LeadText>{errorMessage(error.code)}</LeadText>
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Error</p>
          <p className="mt-2 break-all font-medium text-secondary-foreground">{error.code}</p>
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <Button className="w-full" onClick={onTryAgain} size="lg" type="button">
          <RotateCcwIcon />Try again
        </Button>
        {onResume ? (
          <Button className="w-full" onClick={onResume} size="lg" type="button">
            Resume setup with this Pubky
          </Button>
        ) : null}
        <BackButton onClick={onBack} />
      </div>
    </PassportScreen>
  );
}

function errorMessage(code: GoogleIdentityFlowError["code"]): string {
  switch (code) {
    case "signin_failed": return "Passport found your encrypted identity, but could not sign in to its homeserver.";
    case "signup_failed": return "Passport found your encrypted identity, but could not finish homeserver setup.";
    case "discovery_failed": return "Passport could not resolve or publish the identity's PKDNS record.";
    case "local_save_failed": return "Your identity was activated, but could not be saved in this browser.";
    case "homeserver_unavailable": return "No homeserver is currently available to finish identity setup.";
    case "network_failed": return "A network request required to finish identity setup failed.";
    default: return "Passport could not finish creating or restoring your Pubky.";
  }
}

export { GoogleIdentityError };
