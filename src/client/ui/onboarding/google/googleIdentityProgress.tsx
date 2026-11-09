import type { GoogleIdentityProgress as GoogleIdentityProgressState } from "@/client/logic/google-identity/GoogleIdentityController";
import {
  IdentityLoading,
  IdentityProgress,
  progressSteps,
  SETUP_LIST_LABEL,
  SETUP_STEP,
  type ChecklistStep,
} from "@/client/ui/shared/identityProgress";
import { SetupProgressProvider } from "@/client/ui/shared/setupProgress";

type ProgressPresentation =
  | { heading: "Loading" }
  | { heading: "Setting up" | "Repairing"; listLabel: string; steps: ChecklistStep[] };

/**
 * One screen for every establishment phase. The Drive lookup and a restore are usually over in a
 * moment, so both stay on one steady "Loading" heading without a checklist; flashing steps past
 * for a few milliseconds reads as a glitch. Setup and repair take longer, so they announce
 * themselves and tick through their steps, starting from the completed Drive lookup. Creating an
 * account is the first step of Google setup, so it shows the stepper that "Backup ready." continues.
 */
function GoogleIdentityProgress({ progress }: { progress: GoogleIdentityProgressState }) {
  const presentation = progressPresentation(progress);
  if (presentation.heading === "Loading") return <IdentityLoading />;
  if (progress.flow !== "create") return <IdentityProgress {...presentation} />;
  return (
    <SetupProgressProvider current={1}>
      <IdentityProgress {...presentation} />
    </SetupProgressProvider>
  );
}

const LOOKUP_STEP = "Check Google Drive for a backup";

function progressPresentation(progress: GoogleIdentityProgressState): ProgressPresentation {
  switch (progress.flow) {
    case "lookup":
    case "restore":
      return { heading: "Loading" };
    case "create":
      return setupPresentation(CREATE_STEP_INDEX[progress.step]);
    case "repair":
      return repairPresentation(REPAIR_STEP_INDEX[progress.step]);
  }
}

const CREATE_STEP_INDEX = {
  preparing: 0,
  creating: 0,
  storing_passport_file: 0,
  signing_up: 1,
  publishing: 2,
  activating: 3,
} satisfies Record<Extract<GoogleIdentityProgressState, { flow: "create" }>["step"], number>;

const REPAIR_STEP_INDEX = {
  signing_up: 1,
  publishing: 2,
  signing_in: 3,
} satisfies Record<Extract<GoogleIdentityProgressState, { flow: "repair" }>["step"], number>;

/** Every flow starts with the completed Drive lookup, so flow indexes are offset by one. */
function flowSteps(labels: string[], activeIndex: number): ChecklistStep[] {
  return progressSteps([LOOKUP_STEP, ...labels], activeIndex + 1);
}

function repairPresentation(activeIndex: number): ProgressPresentation {
  return {
    heading: "Repairing",
    listLabel: "Steps to repair your pubky",
    steps: flowSteps(
      ["Unlock your backup", "Finish your earlier setup", SETUP_STEP.publish, "Sign in"],
      activeIndex,
    ),
  };
}

function setupPresentation(activeIndex: number): ProgressPresentation {
  return {
    heading: "Setting up",
    listLabel: SETUP_LIST_LABEL,
    steps: flowSteps(
      [
        "Save encrypted backup to Google Drive",
        SETUP_STEP.createAccount,
        SETUP_STEP.publish,
        SETUP_STEP.finish,
      ],
      activeIndex,
    ),
  };
}

export { GoogleIdentityProgress };
