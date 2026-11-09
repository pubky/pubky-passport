import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

/** Shown while Apple's sign-in window is open. */
function AppleSignInScreen({ onFocus, onCancel }: { onFocus: () => void; onCancel: () => void }) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <p className="text-sm text-muted-foreground">Step 1 of 2: sign in with Apple</p>
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading accent="Apple." aria-label="Signing in with Apple.">
          Signing in with{" "}
        </DisplayHeading>
        <LeadText>Complete the request in Apple&apos;s window.</LeadText>
      </div>
      <div className="flex flex-col gap-3">
        <Button onClick={onFocus} size="lg" type="button">
          Bring back Apple’s window
        </Button>
        <Button onClick={onCancel} size="lg" type="button" variant="secondary">
          Cancel and try again
        </Button>
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner
          aria-hidden="true"
          className="size-4 motion-reduce:animate-none"
          role="presentation"
        />
        Waiting for Apple...
      </p>
    </PassportScreen>
  );
}

export { AppleSignInScreen };
