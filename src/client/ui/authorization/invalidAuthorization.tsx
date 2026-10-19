import { Button } from "@/client/ui/shared/primitives/button";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

function InvalidAuthorization({
  onBack,
  interrupted = false,
}: {
  onBack: () => void;
  interrupted?: boolean;
}) {
  if (interrupted)
    return (
      <PassportScreen className="gap-6">
        <DisplayHeading accent="interrupted." aria-label="Sign-in interrupted">
          Sign-in
        </DisplayHeading>
        <LeadText>
          Passport could not resume your sign-in after Google. The request may have expired or
          become unavailable.
        </LeadText>
        <LeadText>
          Return to the app where you started and choose sign in again. If it is open in another
          tab, switch back to that tab. You do not need to paste an authorization link.
        </LeadText>
        <PassportNavigation
          back={
            <Button size="lg" variant="outline" onClick={onBack}>
              Go to Passport home
            </Button>
          }
        />
      </PassportScreen>
    );
  return (
    <PassportScreen className="gap-6">
      <DisplayHeading accent="request." aria-label="Invalid authorization request">
        Invalid authorization
      </DisplayHeading>
      <LeadText>
        The authorization link is malformed, unsafe, or no longer supported. Return to the app where
        you started and choose sign in again.
      </LeadText>
      <PassportNavigation back={<BackButton onClick={onBack} />} />
    </PassportScreen>
  );
}

export { InvalidAuthorization };
