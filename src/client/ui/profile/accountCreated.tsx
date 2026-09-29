import { PUBKY_COPY_TOASTS } from "@/client/ui/shared/copyToClipboard";
import { DetailField } from "@/client/ui/shared/detailField";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { OutcomeScreen } from "@/client/ui/shared/outcomeScreen";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";

/**
 * The moment a new account with a key in this browser exists, before the optional profile: it
 * names the new pubky and where its key is, then offers the profile or skipping it. During an
 * app's request it also says that skipping goes on to that sign-in.
 */
export function AccountCreated({
  publicKeyZ32,
  forRequest = false,
  onAddProfile,
  onSkip,
}: {
  publicKeyZ32: string;
  /** An app's sign-in request waits, and Skip for now continues to it. */
  forRequest?: boolean;
  onAddProfile: () => void;
  onSkip: () => void;
}) {
  return (
    <OutcomeScreen
      accent="created."
      action={
        <PassportNavigation
          back={
            <Button className="w-full" onClick={onSkip} size="lg" variant="outline">
              Skip for now
            </Button>
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
        forRequest
          ? "Your key is saved in this browser. Keep your recovery file and its password safe. Add a profile now, or skip it and continue signing in."
          : "Your key is saved in this browser. Keep your recovery file and its password safe: together they bring this account back."
      }
      title="Account"
    >
      <DetailField
        copy={{ ...PUBKY_COPY_TOASTS, value: publicKeyZ32 }}
        label="Your pubky"
        value={publicKeyZ32}
      />
    </OutcomeScreen>
  );
}
