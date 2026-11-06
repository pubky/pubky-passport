import { BackButton } from "@/client/ui/shared/backButton";
import { CloudIcon } from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

const NOTICES = {
  icloud_sign_in_cancelled: "The iCloud window was closed before you signed in.",
  icloud_popup_blocked:
    "Your browser blocked the iCloud window. Allow popups for Passport and try again.",
} as const;

/**
 * Second step of Apple login. Browsers only open a popup from a click, so iCloud gets its own
 * button after Sign in with Apple.
 */
function ConnectICloudScreen({
  notice,
  onBack,
  onConnect,
  pending,
  purpose,
  ready,
}: {
  notice?: keyof typeof NOTICES | undefined;
  onBack: () => void;
  onConnect: () => void;
  pending: boolean;
  purpose: "setup" | "detach";
  ready: boolean;
}) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading accent="iCloud." aria-label="Connect iCloud.">
          Connect{" "}
        </DisplayHeading>
        <LeadText>
          {purpose === "setup"
            ? "Passport keeps your key encrypted in your iCloud. Apple stores only the encrypted file. Passport's server never sees it."
            : "Sign in to iCloud with the Apple Account that holds your encrypted key, so Passport can delete it."}
        </LeadText>
      </div>
      {notice ? <FieldMessage error>{NOTICES[notice]}</FieldMessage> : null}
      <PassportNavigation
        back={<BackButton disabled={pending} onClick={onBack} />}
        className="mt-auto md:mt-0"
        confirm={
          <div aria-live="polite" className="w-full">
            <Button
              className="w-full"
              disabled={!ready || pending}
              onClick={onConnect}
              size="lg"
              type="button"
            >
              {pending || !ready ? (
                <Spinner
                  aria-hidden="true"
                  className="size-4 motion-reduce:animate-none"
                  role="presentation"
                />
              ) : (
                <CloudIcon />
              )}
              {pending ? "Waiting for iCloud..." : "Connect iCloud"}
            </Button>
          </div>
        }
      />
    </PassportScreen>
  );
}

export { ConnectICloudScreen };
