import type { GoogleIdentityProgress as GoogleIdentityProgressState } from "../../../logic/google-identity/GoogleIdentityController";
import { PassportScreen } from "../../shared/passportScreen";
import { Button } from "../../shared/primitives/button";
import { Spinner } from "../../shared/primitives/spinner";
import { DisplayHeading, LeadText } from "../../shared/primitives/typography";
import { SignInContext } from "../../shared/signInContext";

type StepState = "complete" | "active" | "pending";
type SetupStep = { label: string; state: StepState };
type ProgressPresentation = {
  heading: "Setting up" | "Restoring" | "Repairing";
  listLabel: string;
  steps: SetupStep[];
};

function GoogleIdentityProgress({
  progress,
  signInTo,
}: {
  progress: GoogleIdentityProgressState;
  signInTo?: string;
}) {
  if (progress.flow === "lookup") {
    return <IdentityLookup {...(signInTo ? { signInTo } : {})} />;
  }

  const presentation = progressPresentation(progress);
  const activeStep = presentation.steps.find((step) => step.state === "active");

  return (
    <PassportScreen>
      <div className="flex flex-1 flex-col gap-6 md:gap-8">
        <DisplayHeading
          accent="your pubky."
          aria-label={`${presentation.heading} your pubky.`}
          desktopAccentOnNewLine
        >
          {presentation.heading}
        </DisplayHeading>
        {signInTo ? <SignInContext requester={signInTo} /> : null}
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

function IdentityLookup({ signInTo }: { signInTo?: string }) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading
          accent={<span className="md:whitespace-nowrap">existing Pubky.</span>}
          aria-label="Looking for existing Pubky."
        >
          Looking for
        </DisplayHeading>
        {signInTo ? <SignInContext requester={signInTo} /> : null}
        <LeadText>Checking Google Drive for an encrypted Passport file.</LeadText>
      </div>
      <div role="status">
        <Button
          className="w-full md:w-[249px]"
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
          Checking Google Drive...
        </Button>
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
  progress: Exclude<GoogleIdentityProgressState, { flow: "lookup" }>,
): ProgressPresentation {
  switch (progress.flow) {
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

function restorePresentation(activeIndex: number): ProgressPresentation {
  return {
    heading: "Restoring",
    listLabel: "Pubky identity restore progress",
    steps: states(["Restore encrypted backup", "Sign in to the homeserver"], activeIndex),
  };
}

function repairPresentation(activeIndex: number): ProgressPresentation {
  return {
    heading: "Repairing",
    listLabel: "Pubky identity repair progress",
    steps: states(
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
    steps: states(
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

export { GoogleIdentityProgress };
