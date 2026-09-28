import type { GoogleIdentityProgress as GoogleIdentityProgressState } from "@/client/logic/google-identity/GoogleIdentityController";
import {
  IdentityProgress,
  progressSteps,
  type ChecklistStep,
} from "@/client/ui/shared/identityProgress";

type ProgressPresentation = {
  heading: "Looking for" | "Setting up" | "Repairing";
  listLabel: string;
  steps: ChecklistStep[];
};

/**
 * One screen for every establishment phase. The Drive lookup is the first step of each flow. A
 * restore is usually over in a moment, so it finishes under the lookup heading and only ticks
 * its remaining steps; setup and repair take longer and announce themselves.
 */
function GoogleIdentityProgress({ progress }: { progress: GoogleIdentityProgressState }) {
  const presentation = progressPresentation(progress);
  return <IdentityProgress {...presentation} />;
}

const LOOKUP_STEP = "Check Google Drive for a backup";

function progressPresentation(progress: GoogleIdentityProgressState): ProgressPresentation {
  switch (progress.flow) {
    case "lookup":
      return {
        heading: "Looking for",
        listLabel: "Pubky identity lookup progress",
        steps: progressSteps([LOOKUP_STEP], 0),
      };
    case "create":
      return setupPresentation(CREATE_STEP_INDEX[progress.step]);
    case "restore":
      return restorePresentation(RESTORE_STEP_INDEX[progress.step]);
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

const RESTORE_STEP_INDEX = {
  restoring: 0,
  signing_in: 1,
} satisfies Record<Extract<GoogleIdentityProgressState, { flow: "restore" }>["step"], number>;

const REPAIR_STEP_INDEX = {
  signing_up: 1,
  publishing: 2,
  signing_in: 3,
} satisfies Record<Extract<GoogleIdentityProgressState, { flow: "repair" }>["step"], number>;

/** Every flow starts with the completed Drive lookup, so flow indexes are offset by one. */
function flowSteps(labels: string[], activeIndex: number): ChecklistStep[] {
  return progressSteps([LOOKUP_STEP, ...labels], activeIndex + 1);
}

function restorePresentation(activeIndex: number): ProgressPresentation {
  return {
    heading: "Looking for",
    listLabel: "Pubky identity restore progress",
    steps: flowSteps(["Restore encrypted backup", "Sign in to the homeserver"], activeIndex),
  };
}

function repairPresentation(activeIndex: number): ProgressPresentation {
  return {
    heading: "Repairing",
    listLabel: "Pubky identity repair progress",
    steps: flowSteps(
      [
        "Restore encrypted backup",
        "Repair homeserver access",
        "Publish PKDNS records",
        "Sign in to the homeserver",
      ],
      activeIndex,
    ),
  };
}

function setupPresentation(activeIndex: number): ProgressPresentation {
  return {
    heading: "Setting up",
    listLabel: "Pubky identity setup progress",
    steps: flowSteps(
      [
        "Store encrypted backup",
        "Sign up to the homeserver",
        "Publish PKDNS records",
        "Activate identity",
      ],
      activeIndex,
    ),
  };
}

export { GoogleIdentityProgress };
