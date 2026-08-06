"use client";

import type { GoogleBackedIdentityProgress } from "../../browser/identity/passportIdentity";
import { DisplayHeading } from "../components/typography";

type StepState = "complete" | "active" | "pending";
type SetupStep = { label: string; state: StepState };
type DeterminedIdentityProgress = Exclude<GoogleBackedIdentityProgress, "preparing_secure_identity" | "checking_passport_file">;

function SetupProgress({ progress }: { progress: DeterminedIdentityProgress }) {
  const steps = progressSteps(progress);
  const restoring = progress === "restoring_identity" || progress === "activating_restored_identity";

  return (
    <main className="mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col px-6 pb-6 pt-3">
      <div className="flex flex-1 flex-col gap-6">
        <DisplayHeading accent="your pubky." aria-label={`${restoring ? "Restoring" : "Setting up"} your pubky.`}>{restoring ? "Restoring" : "Setting up"}</DisplayHeading>
        <ol aria-label="Pubky identity setup progress" className="flex flex-col gap-6 py-3">
          {steps.map((step) => <ProgressStep key={step.label} step={step} />)}
        </ol>
      </div>
    </main>
  );
}

function ProgressStep({ step }: { step: SetupStep }) {
  return (
    <li className="flex items-center gap-2" data-state={step.state}>
      {step.state === "complete" ? <CompleteIcon /> : step.state === "active" ? <ActiveIcon /> : <PendingIcon />}
      <strong className={step.state === "complete" ? "text-brand" : step.state === "pending" ? "text-muted-foreground" : "text-foreground"}>{step.label}</strong>
      <span className="sr-only"> ({step.state})</span>
    </li>
  );
}

function progressSteps(progress: DeterminedIdentityProgress): SetupStep[] {
  if (progress === "restoring_identity" || progress === "activating_restored_identity") {
    return states(["Restoring your Pubky", "Activate identity"], progress === "restoring_identity" ? 0 : 1);
  }

  const activeIndex = progress === "signing_up_to_homeserver" ? 1
    : progress === "publishing_discovery" ? 2
      : progress === "activating_created_identity" ? 3 : 0;
  return states(["Store encrypted backup", "Sign up to the homeserver", "Publish PKDNS records", "Activate identity"], activeIndex);
}

function states(labels: string[], activeIndex: number): SetupStep[] {
  return labels.map((label, index) => ({ label, state: index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending" }));
}

function CompleteIcon() {
  return <svg aria-hidden="true" className="size-6 shrink-0 text-brand" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" stroke="currentColor" /><path d="m7.5 12 3 3 6-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>;
}

function ActiveIcon() {
  return <svg aria-hidden="true" className="size-6 shrink-0 animate-spin text-foreground" fill="none" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>;
}

function PendingIcon() {
  return <svg aria-hidden="true" className="size-6 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" stroke="currentColor" /></svg>;
}

export { SetupProgress, progressSteps };
