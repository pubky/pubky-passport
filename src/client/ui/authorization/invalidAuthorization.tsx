import { BackButton } from "@/client/ui/shared/backButton";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";

function InvalidAuthorization({ onBack }: { onBack: () => void }) {
  return (
    <ErrorScreen
      accent="request."
      back={<BackButton onClick={onBack} />}
      cause="The authorization link is malformed, unsafe, or no longer supported."
      label="Invalid authorization request"
      nextStep="Return to the app and start the sign-in again."
      title="Invalid authorization"
    />
  );
}

export { InvalidAuthorization };
