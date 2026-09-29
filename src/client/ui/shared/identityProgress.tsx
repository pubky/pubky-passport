import { PassportScreen } from "./passportScreen";
import { DisplayHeading } from "./primitives/typography";

export type ChecklistStep = { label: string; state: "complete" | "active" | "pending" };

export function IdentityProgress({
  heading,
  listLabel,
  steps,
}: {
  heading: string;
  listLabel: string;
  steps: ChecklistStep[];
}) {
  const activeStep = steps.find((step) => step.state === "active");
  return (
    // The same space under the setup stepper as every other step (it was 8px here).
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-1 flex-col gap-6 md:gap-8">
        <DisplayHeading
          accent="your pubky."
          aria-label={`${heading} your pubky.`}
          desktopAccentOnNewLine
        >
          {heading}
        </DisplayHeading>
        <p aria-atomic="true" className="sr-only" role="status">
          {heading} your Pubky: {activeStep?.label}.
        </p>
        <ol aria-label={listLabel} className="flex flex-col gap-6 py-3">
          {steps.map((step) => (
            <ProgressStep key={step.label} step={step} />
          ))}
        </ol>
      </div>
    </PassportScreen>
  );
}

function ProgressStep({ step }: { step: ChecklistStep }) {
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

export function progressSteps(labels: string[], activeIndex: number): ChecklistStep[] {
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

/**
 * A steady loading screen for work that is usually over in a moment (a Drive lookup, a quick
 * restore): flashing steps past for a few milliseconds reads as a glitch, so there is no list.
 */
export function IdentityLoading() {
  return (
    <PassportScreen>
      <div className="flex flex-1 flex-col gap-6 md:gap-8">
        <DisplayHeading
          accent="your pubky."
          aria-label="Loading your pubky."
          desktopAccentOnNewLine
        >
          Loading
        </DisplayHeading>
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
