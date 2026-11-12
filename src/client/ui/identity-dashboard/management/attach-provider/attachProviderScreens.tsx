import Image from "next/image";

import type { AppleIdentityViewError } from "@/client/logic/apple-identity/AppleIdentityController";
import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import type { IdentityProviderAccount } from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { GoogleIdentityErrorDetails as IdentityErrorDetails } from "@/client/ui/googleIdentityErrorDetails";
import { ContinueWithApple } from "@/client/ui/onboarding/apple/continueWithApple";
import { ContinueWithGoogle } from "@/client/ui/onboarding/google/continueWithGoogle";
import { ProviderChoice } from "@/client/ui/onboarding/providerChoice";
import { BackButton } from "@/client/ui/shared/backButton";
import { CheckIcon } from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { ProviderAccountCard } from "@/client/ui/shared/providerAccountCard";

type ProviderName = "Google" | "Apple";

type AttachErrorCode = GoogleIdentityViewError["code"] | AppleIdentityViewError["code"];

/** What a stopped attach left behind, so the error screen never claims more than it knows. */
type AttachFailureEffect = "browser-only" | "unchanged" | "may-have-stored";

/**
 * No default branch on purpose: a new or renamed code fails typechecking until someone decides
 * what it leaves behind.
 */
function attachFailureEffect(code: AttachErrorCode): AttachFailureEffect {
  switch (code) {
    // The backup is, or may be, stored: a failed or conflicting upload can still have written
    // the file, and an unexpected failure may come after the upload.
    case "local_link_failed":
    case "identity_linked_meanwhile":
    case "drive_create_conflict":
    case "drive_write_failed":
    case "icloud_create_conflict":
    case "icloud_write_failed":
    case "cancelled":
    case "operation_failed":
    case "unexpected_failure":
      return "may-have-stored";
    // Nothing was written, but the pubky has another account or may no longer be here.
    case "identity_already_linked":
    case "local_identity_unavailable":
      return "unchanged";
    // Raised before anything is written. This list also holds codes attach cannot produce today:
    // review it whenever an attach path changes.
    case "apple_account_mismatch":
    case "apple_session_expired":
    case "apple_sign_in_cancelled":
    case "apple_sign_in_failed":
    case "apple_sign_in_popup_blocked":
    case "authorization_failed":
    case "create_failed":
    case "decrypt_failed":
    case "drive_read_failed":
    case "encrypt_failed":
    case "google_account_mismatch":
    case "google_authorization_denied":
    case "google_authorization_failed":
    case "google_authorization_popup_closed":
    case "google_authorization_popup_failed_to_open":
    case "google_detachment_permission_required":
    case "google_drive_access_required":
    case "google_drive_cleanup_failed":
    case "homeserver_not_found":
    case "homeserver_signup_token_failed":
    case "icloud_account_mismatch":
    case "icloud_cleanup_failed":
    case "icloud_network_failed":
    case "icloud_other_origin":
    case "icloud_popup_blocked":
    case "icloud_quota_exceeded":
    case "icloud_read_failed":
    case "icloud_record_missing":
    case "icloud_sign_in_cancelled":
    case "icloud_sign_in_failed":
    case "icloud_sign_in_timeout":
    case "icloud_unavailable":
    case "icloud_web_access_disabled":
    case "identity_mismatch":
    case "invalid_passport_file":
    case "invalid_passport_file_delete_failed":
    case "local_remove_failed":
    case "local_save_failed":
    case "provider_account_in_use":
    case "publication_failed":
    case "restore_failed":
    case "signin_failed":
    case "signup_failed":
    case "undecryptable_passport_file_delete_failed":
    case "visible_backup_permission_missing":
    case "wrapping_key_failed":
      return "browser-only";
  }
}

function PubkyCard({ publicIdentity }: { publicIdentity: PubkyPublicIdentity }) {
  return (
    <div className="min-h-[84px] rounded-xl border border-brand/32 p-[15px] shadow-xl">
      <p className="mb-2 text-xs font-medium uppercase leading-5 tracking-[0.1em] text-brand">
        Your Pubky
      </p>
      <p className="break-all font-medium leading-6 text-secondary-foreground">
        {publicIdentity.publicKeyZ32}
      </p>
    </div>
  );
}

/** Which account to back this pubky up with, using the same buttons and notice as sign-in. */
function AttachProviderChoice({
  apple,
  onBack,
  onContinueWithGoogle,
  publicIdentity,
}: {
  apple: { ready: boolean; onContinue: () => void } | null;
  onBack: () => void;
  onContinueWithGoogle: () => void;
  publicIdentity: PubkyPublicIdentity;
}) {
  return (
    <PassportScreen className="gap-6">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="account." aria-label="Connect an account.">
          Connect an
        </DisplayHeading>
        <LeadText>
          {apple
            ? "Back up this pubky in your Google Drive or iCloud. Signing in with that account then restores it on any device."
            : "Back up this pubky in your Google Drive. Signing in with Google then restores it on any device."}
        </LeadText>
      </div>
      <PubkyCard publicIdentity={publicIdentity} />
      <ProviderChoice apple={apple} onContinueWithGoogle={onContinueWithGoogle} />
      <PassportNavigation back={<BackButton onClick={onBack} />} className="mt-auto" />
    </PassportScreen>
  );
}

/** Shown while Passport reads the account's file and stores the backup. */
function AttachingScreen({ storageName }: { storageName: string }) {
  return (
    <PassportScreen className="gap-6">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="backup." aria-label="Saving backup.">
          Saving
        </DisplayHeading>
        <LeadText>Passport is saving the encrypted backup in {storageName}.</LeadText>
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner
          aria-hidden="true"
          className="size-4 motion-reduce:animate-none"
          role="presentation"
        />
        Keep this window open.
      </p>
    </PassportScreen>
  );
}

/**
 * A stopped attach. Below the message it says what is left: nothing changed and the pubky is
 * still only in this browser, nothing changed but it has another account, or nothing at all
 * when the backup may already be stored. An account that already holds another pubky gets its
 * own heading, since trying again only helps with another account.
 */
function AttachError({
  accountNotice,
  error,
  message,
  onBack,
  onTryAgain,
  provider,
}: {
  accountNotice?: string | undefined;
  error: { code: AttachErrorCode; detailCode?: string | undefined };
  message: string;
  onBack: () => void;
  onTryAgain: () => void;
  provider: ProviderName;
}) {
  const accountInUse = error.code === "provider_account_in_use";
  const effect = attachFailureEffect(error.code);
  return (
    <PassportScreen className="gap-6">
      <div className="flex flex-col gap-6">
        {accountInUse ? (
          <DisplayHeading accent="in use." aria-label="Account in use.">
            Account
          </DisplayHeading>
        ) : (
          <DisplayHeading accent="connected." aria-label="Not connected.">
            Not
          </DisplayHeading>
        )}
        <LeadText>{message}</LeadText>
        {accountNotice ? (
          <p className="break-words text-sm font-medium leading-5 text-muted-foreground">
            {accountNotice}
          </p>
        ) : null}
        {effect === "may-have-stored" ? null : (
          <p className="text-sm leading-5 text-muted-foreground">
            {effect === "browser-only"
              ? "Nothing was changed. This pubky stays in this browser only."
              : "Nothing was changed."}
          </p>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        {accountInUse ? null : <IdentityErrorDetails error={error} />}
        <div
          aria-label="Error actions"
          className="mt-auto grid w-full grid-cols-1 gap-3"
          role="group"
        >
          <div className="w-full">
            {provider === "Google" ? (
              <ContinueWithGoogle onContinue={onTryAgain} />
            ) : (
              <ContinueWithApple autoFocus onContinue={onTryAgain} />
            )}
          </div>
          <BackButton onClick={onBack} />
        </div>
      </div>
    </PassportScreen>
  );
}

/** The pubky now has the provider's backup; Done returns to Manage identity. */
function AttachComplete({
  account,
  attachment,
  notice,
  onDone,
  publicIdentity,
  storageName,
}: {
  account: IdentityProviderAccount;
  attachment: "created" | "linked";
  notice?: string | undefined;
  onDone: () => void;
  publicIdentity: PubkyPublicIdentity;
  storageName: string;
}) {
  const providerName: ProviderName = account.provider === "google" ? "Google" : "Apple";
  return (
    <PassportScreen className="gap-0">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent={`to ${providerName}.`} aria-label={`Connected to ${providerName}.`}>
          Connected
        </DisplayHeading>
        <LeadText>
          {attachment === "created"
            ? `Stored backup in ${storageName}.`
            : `${storageName} already held the backup of this pubky.`}
        </LeadText>
      </div>
      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        {notice ? (
          <p
            className="mb-6 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm leading-5"
            role="status"
          >
            {notice}
          </p>
        ) : null}
        <ProviderAccountCard account={account} />
        <div className="mt-6">
          <PubkyCard publicIdentity={publicIdentity} />
        </div>
        <Image
          alt=""
          aria-hidden="true"
          className="mx-auto mt-6 size-50"
          height={200}
          src="/illustrations/checkmark.png"
          width={200}
        />
        <Button className="mt-auto w-full" onClick={onDone} size="lg" type="button">
          <CheckIcon />
          Done
        </Button>
      </div>
    </PassportScreen>
  );
}

export { AttachComplete, AttachError, AttachingScreen, AttachProviderChoice };
