import { BackButton } from "../shared/backButton";
import { PassportNavigation } from "../shared/passportNavigation";
import { PassportScreen } from "../shared/passportScreen";
import { DisplayHeading, LeadText } from "../shared/primitives/typography";

function InvalidAuthorization({ onBack }: { onBack: () => void }) {
  return (
    <PassportScreen className="gap-6">
      <DisplayHeading accent="request." aria-label="Invalid authorization request">
        Invalid authorization
      </DisplayHeading>
      <LeadText>The authorization link is malformed, unsafe, or no longer supported.</LeadText>
      <PassportNavigation back={<BackButton onClick={onBack} />} />
    </PassportScreen>
  );
}

export { InvalidAuthorization };
