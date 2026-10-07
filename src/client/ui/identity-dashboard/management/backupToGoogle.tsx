import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import {
  DRIVE_PERMISSION_HINT,
  GoogleDrivePermissionPrompt,
} from "@/client/ui/googleDrivePermissionPrompt";
import { googleIdentityErrorMessage } from "@/client/ui/googleIdentityErrorMessage";
import { GoogleAccessScreen } from "@/client/ui/onboarding/google/googleAccessScreen";
import { GoogleAccountCard } from "@/client/ui/onboarding/google/googleAccountCard";
import { VisibleCopyNotice } from "@/client/ui/onboarding/google/visibleCopyNotice";
import { BackButton } from "@/client/ui/shared/backButton";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { CheckIcon, RotateCcwIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { OutcomeScreen } from "@/client/ui/shared/outcomeScreen";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText, TEXT_MEASURE } from "@/client/ui/shared/primitives/typography";
import { useBackupToGoogle } from "./useBackupToGoogle";

export function BackupToGoogle({
  publicIdentity,
  onBack,
}: {
  publicIdentity: PubkyPublicIdentity;
  onBack: () => void;
}) {
  const operation = useBackupToGoogle(publicIdentity);
  const state = operation.state;
  if (state.status === "permission-required") {
    return (
      <GoogleDrivePermissionPrompt
        mode={state.mode}
        onBack={onBack}
        onTryAgain={operation.retry}
        onContinue={operation.continueWithoutVisibleBackup}
      />
    );
  }
  if (state.status === "authorizing") {
    return (
      <GoogleAccessScreen
        onCancel={operation.cancelAuthorization}
        onShowGoogleWindow={operation.showAuthorizationWindow}
      />
    );
  }
  if (state.status === "complete") {
    return (
      <OutcomeScreen
        accent="attached."
        action={
          <Button className="w-full" onClick={onBack} size="lg">
            <CheckIcon />
            Done
          </Button>
        }
        description="You can now sign in to Passport with this Google account. Your encrypted identity is backed up in Google Drive, and you’re still signed in on this device."
        label="Google account attached."
        title="Google account"
      >
        <GoogleAccountCard account={state.backup.googleAccount} />
        <VisibleCopyNotice
          className={TEXT_MEASURE}
          status={state.backup.visibleRecoveryCopyStatus}
        />
      </OutcomeScreen>
    );
  }
  const pending = state.status === "pending";
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <DisplayHeading accent="to Google.">Attach</DisplayHeading>
      <LeadText>
        Sign in with Google and keep an encrypted backup of this identity in your Google Drive.
        Choose a Google account that doesn’t already have a Passport backup. {DRIVE_PERMISSION_HINT}
      </LeadText>
      {state.status === "failed" ? (
        <Notice className={TEXT_MEASURE} tone="error">
          {googleIdentityErrorMessage(state.error, { operation: "attach" })}
        </Notice>
      ) : null}
      <PassportNavigation
        back={<BackButton onClick={onBack} disabled={pending} />}
        confirm={
          <Button className="w-full" onClick={operation.retry} loading={pending} size="lg">
            {state.status === "failed" ? <RotateCcwIcon /> : <GoogleLogo />}
            {pending ? "Attaching…" : state.status === "failed" ? "Try again" : "Attach to Google"}
          </Button>
        }
      />
    </PassportScreen>
  );
}
