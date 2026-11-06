import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

/** Shown while Apple's sign-in window is open. */
function AppleSignInScreen() {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading accent="Apple." aria-label="Signing in with Apple.">
          Signing in with{" "}
        </DisplayHeading>
        <LeadText>Complete the request in Apple&apos;s window.</LeadText>
      </div>
      <div aria-live="polite" role="status">
        <Button
          className="w-full md:w-[220px]"
          disabled
          size="lg"
          type="button"
          variant="secondary"
        >
          <Spinner
            aria-hidden="true"
            className="size-4 motion-reduce:animate-none"
            role="presentation"
          />
          Waiting for Apple...
        </Button>
      </div>
    </PassportScreen>
  );
}

export { AppleSignInScreen };
