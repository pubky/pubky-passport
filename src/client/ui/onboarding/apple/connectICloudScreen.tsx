import type { ICloudConnectionError } from "@/client/logic/apple-identity/ICloudConnection";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { appleIdentityErrorMessage } from "./appleIdentityErrorMessage";
import { ContinueWithApple } from "./continueWithApple";

/** Explicit second step, also used when the first Apple window cannot be reused. */
function ConnectICloudScreen({
  notice,
  onBack,
  onConnect,
  onFocus,
  onCancel,
  pending,
  purpose,
  ready,
}: {
  notice?: ICloudConnectionError["code"] | undefined;
  onBack: () => void;
  onConnect: () => void;
  onFocus?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  pending: boolean;
  purpose: "setup" | "detach";
  ready: boolean;
}) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <p className="text-sm text-muted-foreground">
        Step 2 of 2: {purpose === "detach" ? "open iCloud" : "connect to iCloud"}
      </p>
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading
          accent={pending ? "window." : "One more step."}
          aria-label={
            pending ? "Finish in Apple's window." : "Signed in with Apple. One more step."
          }
          className="text-4xl md:text-5xl"
        >
          {pending ? "Finish in Apple’s" : "Signed in with Apple."}
        </DisplayHeading>
        <LeadText>
          {purpose === "setup"
            ? pending
              ? "In Apple’s window, allow Passport to use iCloud for your encrypted backup."
              : "Allow Passport to use iCloud for your encrypted backup."
            : "Sign in to iCloud with the Apple Account that holds your encrypted key, so Passport can delete it."}
        </LeadText>
      </div>
      {notice ? (
        <div className="flex flex-col gap-3">
          <FieldMessage className="text-base leading-6" error>
            {appleIdentityErrorMessage(notice)}
          </FieldMessage>
          {notice === "icloud_web_access_disabled" ? (
            <a
              className="font-medium text-brand underline underline-offset-4"
              href="https://support.apple.com/kb/HT212523"
              target="_blank"
              rel="noreferrer"
            >
              How to allow web access to iCloud data
            </a>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        {pending ? (
          <>
            <p className="text-sm text-muted-foreground" role="status">
              Complete the iCloud request in Apple’s window.
            </p>
            <Button onClick={onFocus} size="lg" type="button">
              Return to Apple’s window
            </Button>
            <Button onClick={onCancel} size="lg" type="button" variant="secondary">
              Cancel and try again
            </Button>
          </>
        ) : (
          <>
            {!ready ? (
              <p className="text-sm text-muted-foreground" role="status">
                Preparing iCloud…
              </p>
            ) : null}
            <ContinueWithApple
              autoFocus={Boolean(notice)}
              disabled={!ready}
              onContinue={onConnect}
              purpose={purpose}
            />
          </>
        )}
        {!pending ? <BackButton onClick={onBack} /> : null}
      </div>
    </PassportScreen>
  );
}

export { ConnectICloudScreen };
