import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { GoogleDrivePermissionPrompt } from "@/client/ui/googleDrivePermissionPrompt";
import { googleIdentityErrorMessage } from "@/client/ui/googleIdentityErrorMessage";
import { BackButton } from "@/client/ui/shared/backButton";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { RotateCcwIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
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
  if (state.status === "complete") {
    return (
      <PassportScreen className="gap-6 md:gap-8">
        <DisplayHeading accent="attached.">Google account</DisplayHeading>
        <LeadText>
          You can now sign in to Passport with this Google account. Your encrypted identity is
          backed up in Google Drive, and you’re still signed in on this device.
        </LeadText>
        {state.backup.visibleRecoveryCopyStatus !== "created" ? (
          <FieldMessage>
            {state.backup.visibleRecoveryCopyStatus === "skipped"
              ? "No visible recovery copy was created. Your private Google Drive backup is ready."
              : "Your private Google Drive backup is ready, but the visible recovery copy could not be confirmed."}
          </FieldMessage>
        ) : null}
        <Button onClick={onBack} size="lg">
          Done
        </Button>
      </PassportScreen>
    );
  }
  const pending = state.status === "pending";
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <DisplayHeading accent="to Google.">Attach</DisplayHeading>
      <LeadText>
        Sign in with Google and keep an encrypted backup of this identity in your Google Drive.
        Choose a Google account that doesn’t already have a Passport backup.
      </LeadText>
      {state.status === "failed" ? (
        <Notice tone="error">{googleIdentityErrorMessage(state.error.code, "attach")}</Notice>
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
