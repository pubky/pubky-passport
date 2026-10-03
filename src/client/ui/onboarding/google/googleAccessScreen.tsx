import { GooglePermissionGuide } from "@/client/ui/googleDrivePermissionPrompt";
import { CancelButton } from "@/client/ui/shared/cancelButton";
import { AppWindowIcon } from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

/**
 * Shown while Google's window waits for the person: what to do there, and a way back to it or
 * out of it. Google's window can slip behind Passport and waits until the authorization times
 * out, so the screen never leaves the person with nothing to press. (When the browser blocks
 * Google's window during a request, the sign-in continues in Passport's own window instead, and
 * this screen is not shown.) The guide follows the actions, so they come first in focus order and
 * stay above a popup's fold.
 *
 * Phones open Google's window as a tab, which a page cannot reliably bring back, so with a
 * coarse pointer the screen says to switch tabs instead of offering "Show Google's window".
 */
function GoogleAccessScreen({
  onCancel,
  onShowGoogleWindow,
}: {
  onCancel: () => void;
  onShowGoogleWindow: () => void;
}) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading accent="access.">
          Requesting Google <br className="hidden md:block" />
          <span className="hidden md:inline">Drive</span>
        </DisplayHeading>
        <LeadText>
          Finish in Google’s window: choose your account, tick Select all, then press Continue.
        </LeadText>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p
            aria-live="polite"
            className="flex items-center gap-2 text-sm font-medium leading-5 text-foreground"
            role="status"
          >
            <Spinner className="size-4" decorative />
            Waiting for Google…
          </p>
          <p className="hidden text-sm leading-5 text-muted-foreground pointer-coarse:block">
            Switch back to the Google tab to finish.
          </p>
        </div>
        {/* Cancel takes Back's place and size, so it never reads as a forward action. */}
        <PassportNavigation
          back={<CancelButton onClick={onCancel} />}
          confirm={
            <Button
              className="w-full pointer-coarse:hidden"
              onClick={onShowGoogleWindow}
              size="lg"
              type="button"
              variant="secondary"
            >
              <AppWindowIcon />
              Show Google’s window
            </Button>
          }
        />
      </div>
      {/* The lead above gives the instruction; the picture needs no caption, only its name. */}
      <GooglePermissionGuide compact label="What to tick in Google’s window" />
    </PassportScreen>
  );
}

export { GoogleAccessScreen };
