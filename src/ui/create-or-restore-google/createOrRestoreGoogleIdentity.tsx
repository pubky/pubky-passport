import { GoogleAccessRequest } from "./googleAccessRequest";
import { SetupProgress } from "./setupProgress";
import type { CreateOrRestoreGoogleIdentityState } from "./useCreateOrRestoreGoogleIdentity";

function CreateOrRestoreGoogleIdentity({ onBack, state }: {
  onBack: () => void;
  state: CreateOrRestoreGoogleIdentityState;
}) {
  if (state.status === "access-denied") {
    return <GoogleAccessRequest onBack={onBack} onTryAgain={state.tryAgain} status="denied" />;
  }
  if (state.status === "setup") return <SetupProgress progress={state.progress} />;
  return <GoogleAccessRequest status="pending" />;
}

export { CreateOrRestoreGoogleIdentity };
