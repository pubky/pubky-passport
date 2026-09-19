import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

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
