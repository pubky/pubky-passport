import { HOMESERVER_COPY_TOASTS, PUBKY_COPY_TOASTS } from "@/client/ui/shared/copyToClipboard";
import { DetailField } from "@/client/ui/shared/detailField";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { OutcomeScreen } from "@/client/ui/shared/outcomeScreen";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";

/**
 * The moment a new account with a key in this browser exists, before the optional profile: it
 * names the new pubky, the homeserver it was created on and where its key is, then offers the profile or skipping it. During an
 * app's request it also says that skipping goes on to that sign-in.
 */
export function AccountCreated({
  publicKeyZ32,
  homeserverPubky,
  forRequest = false,
  profileRequired = false,
  onAddProfile,
  onSkip,
}: {
  publicKeyZ32: string;
  /** The homeserver the account was created on, when the identity remembers it. */
  homeserverPubky?: string | undefined;
  /** An app's sign-in request waits, and Skip for now continues to it. */
  forRequest?: boolean;
  /** The waiting app needs a profile, so there is no skipping it. */
  profileRequired?: boolean;
  onAddProfile: () => void;
  /** Absent when the profile cannot be skipped. */
  onSkip?: (() => void) | undefined;
}) {
  return (
    <OutcomeScreen
      accent="created."
      // Two details (the pubky and its homeserver) leave less room for the art.
      compactArt={Boolean(homeserverPubky)}
      action={
        <PassportNavigation
          back={
            onSkip ? (
              <Button className="w-full" onClick={onSkip} size="lg" variant="outline">
                Skip for now
              </Button>
            ) : undefined
          }
          confirm={
            <Button className="w-full" onClick={onAddProfile} size="lg">
              <ArrowRightIcon />
              Add a public profile
            </Button>
          }
          layout="paired"
        />
      }
      description={
        // During a request the lead also says where skipping leads, in the room of its last
        // clause, so both ways on stay in a popup's first screenful.
        profileRequired
          ? "Your key is saved in this browser. Keep your recovery file and its password safe. The app you’re signing in to needs a public profile: add one to continue."
          : forRequest
            ? "Your key is saved in this browser. Keep your recovery file and its password safe. Add a profile now, or skip it and continue signing in."
            : "Your key is saved in this browser. Keep your recovery file and its password safe: together they bring this account back."
      }
      title="Account"
    >
      <div className="flex flex-col gap-4">
        <DetailField
          copy={{ ...PUBKY_COPY_TOASTS, value: publicKeyZ32 }}
          label="Your pubky"
          value={publicKeyZ32}
        />
        {homeserverPubky ? (
          <DetailField
            copy={{ ...HOMESERVER_COPY_TOASTS, value: homeserverPubky }}
            label="Homeserver"
            value={homeserverPubky}
          />
        ) : null}
      </div>
    </OutcomeScreen>
  );
}
