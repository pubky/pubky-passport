import type { IdentityProgress as IdentityProgressState } from "@/client/logic/identity-lifecycle/PassportFileIdentityLifecycle";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";

type StepState = "complete" | "active" | "pending";
type SetupStep = { label: string; state: StepState };
type ProgressPresentation =
  | { heading: "Loading" }
  | { heading: "Setting up" | "Repairing"; listLabel: string; steps: SetupStep[] };

/**
 * One screen for every establishment phase. The backup lookup and a restore are usually over in a
 * moment, so both stay on one steady "Loading" heading without a checklist; flashing steps past
 * for a few milliseconds reads as a glitch. Setup and repair take longer, so they announce
 * themselves and tick through their steps, starting from the completed backup lookup.
 */
function IdentityProgress({
  progress,
  storageName,
}: {
  progress: IdentityProgressState;
  /** Where the encrypted backup lives, for example "Google Drive". */
  storageName: string;
}) {
  const presentation = progressPresentation(progress, storageName);
  const heading = (
    <DisplayHeading accent="your pubky." aria-label={`${presentation.heading} your pubky.`}>
      {presentation.heading}
    </DisplayHeading>
  );

  if (presentation.heading === "Loading") {
    return (
      <PassportScreen>
        <div className="flex flex-1 flex-col gap-6">
          {heading}
          <p aria-atomic="true" className="sr-only" role="status">
            Loading your Pubky.
          </p>
          <div className="py-3">
            <ActiveIcon />
          </div>
        </div>
      </PassportScreen>
    );
  }

  const activeStep = presentation.steps.find((step) => step.state === "active");

  return (
    <PassportScreen>
      <div className="flex flex-1 flex-col gap-6">
        {heading}
        <p aria-atomic="true" className="sr-only" role="status">
          {presentation.heading} your Pubky: {activeStep?.label}.
        </p>
        <ol aria-label={presentation.listLabel} className="flex flex-col gap-6 py-3">
          {presentation.steps.map((step) => (
            <ProgressStep key={step.label} step={step} />
          ))}
        </ol>
      </div>
    </PassportScreen>
  );
}

function ProgressStep({ step }: { step: SetupStep }) {
  return (
    <li
      aria-current={step.state === "active" ? "step" : undefined}
      className="flex items-center gap-2"
    >
      {step.state === "complete" ? (
        <CompleteIcon />
      ) : step.state === "active" ? (
        <ActiveIcon />
      ) : (
        <PendingIcon />
      )}
      <strong
        className={
          step.state === "complete"
            ? "text-brand"
            : step.state === "pending"
              ? "text-muted-foreground"
              : "text-foreground"
        }
      >
        {step.label}
      </strong>
      <span className="sr-only"> ({step.state})</span>
    </li>
  );
}

function progressPresentation(
  progress: IdentityProgressState,
  storageName: string,
): ProgressPresentation {
  const lookupStep = `Check ${storageName} for a backup`;
  switch (progress.flow) {
    case "lookup":
    case "restore":
      return { heading: "Loading" };
    case "create":
      return setupPresentation(lookupStep, CREATE_STEP_INDEX[progress.step]);
    case "repair":
      return repairPresentation(lookupStep, REPAIR_STEP_INDEX[progress.step]);
  }
}

const CREATE_STEP_INDEX = {
  preparing: 0,
  creating: 0,
  storing_passport_file: 0,
  signing_up: 1,
  publishing: 2,
  activating: 3,
} satisfies Record<Extract<IdentityProgressState, { flow: "create" }>["step"], number>;

const REPAIR_STEP_INDEX = {
  signing_up: 1,
  publishing: 2,
  signing_in: 3,
} satisfies Record<Extract<IdentityProgressState, { flow: "repair" }>["step"], number>;

/** Every flow starts with the completed backup lookup, so flow indexes are offset by one. */
function flowSteps(lookupStep: string, labels: string[], activeIndex: number): SetupStep[] {
  return states([lookupStep, ...labels], activeIndex + 1);
}

function repairPresentation(lookupStep: string, activeIndex: number): ProgressPresentation {
  return {
    heading: "Repairing",
    listLabel: "Pubky identity repair progress",
    steps: flowSteps(
      lookupStep,
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

function setupPresentation(lookupStep: string, activeIndex: number): ProgressPresentation {
  return {
    heading: "Setting up",
    listLabel: "Pubky identity setup progress",
    steps: flowSteps(
      lookupStep,
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

function states(labels: string[], activeIndex: number): SetupStep[] {
  return labels.map((label, index) => ({
    label,
    state: index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending",
  }));
}

function CompleteIcon() {
  return (
    <svg aria-hidden="true" className="size-6 shrink-0 text-brand" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" />
      <path
        d="m7.5 12 3 3 6-7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ActiveIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-6 shrink-0 animate-spin text-foreground motion-reduce:animate-none"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M21 12a9 9 0 1 1-9-9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function PendingIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-6 shrink-0 text-muted-foreground"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" />
    </svg>
  );
}

export { IdentityProgress };
