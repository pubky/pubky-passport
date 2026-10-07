"use client";

import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { CheckIcon } from "./icons";
import { cn } from "./mergeClassNames";

/**
 * Account creation, whichever way it goes: Create account (the start page, then a verification),
 * Identity keys (where the key lives: a keychain, this browser or the Google backup, until the
 * account exists) and Profile. An app shows its own steps after these.
 */
export const ONBOARDING_STEPS = ["Create account", "Identity keys", "Profile"] as const;

/** The step a screen belongs to, as an index into {@link ONBOARDING_STEPS}. */
export type OnboardingStep = 0 | 1 | 2;

const Context = createContext<OnboardingStep | null>(null);

/** Marks every PassportScreen inside it as `current`, one step of account creation. */
export function SetupProgressProvider({
  children,
  current,
}: {
  children: ReactNode;
  current: OnboardingStep;
}) {
  return <Context value={current}>{children}</Context>;
}

const PROGRESS_SLOT_ID = "passport-header-progress";
const subscribe = () => () => {};
const getSlot = () => document.getElementById(PROGRESS_SLOT_ID);
const getServerSlot = () => null;

/** Where the header row shows account creation's progress, between the logo and its actions. */
export function SetupProgressSlot() {
  return <div className="flex min-w-0 flex-1 items-center self-stretch" id={PROGRESS_SLOT_ID} />;
}

/**
 * Account creation's progress in the header row, nothing outside a SetupProgressProvider. From md
 * it is the step's name and a numbered circle per step, joined by a line that runs to the header's
 * end (a tick in a finished step); below md a bar, filled by the finished steps, beside the logo
 * (none while nothing is finished). The header stays put while the screens change under it, so
 * the steps never move. Screen readers hear the step by name and number either way.
 */
export function SetupProgress() {
  const current = useContext(Context);
  const slot = useSyncExternalStore(subscribe, getSlot, getServerSlot);
  if (current === null || !slot) return null;
  const last = ONBOARDING_STEPS.length - 1;
  const finished = current / ONBOARDING_STEPS.length;
  return createPortal(
    <nav
      aria-label="Account setup progress"
      className="flex min-w-0 flex-1 items-center justify-end gap-6 md:justify-start md:gap-10 md:pl-6"
    >
      <p className="sr-only">
        Step {current + 1} of {ONBOARDING_STEPS.length}: {ONBOARDING_STEPS[current]}
      </p>
      <p
        aria-hidden="true"
        className="hidden shrink-0 whitespace-nowrap text-2xl font-light leading-8 text-muted-foreground md:block"
      >
        {ONBOARDING_STEPS[current]}
      </p>
      {finished > 0 ? (
        <div
          aria-hidden="true"
          className="h-2.5 w-full max-w-52 overflow-hidden rounded-full bg-secondary md:hidden"
        >
          <div className="h-full rounded-full bg-brand" style={{ width: `${finished * 100}%` }} />
        </div>
      ) : null}
      <ol aria-hidden="true" className="hidden min-w-0 flex-1 items-center md:flex">
        {ONBOARDING_STEPS.map((label, index) => {
          const state = index < current ? "complete" : index === current ? "current" : "pending";
          return (
            <li className="flex min-w-0 flex-1 items-center last:flex-none" key={label}>
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold",
                  state === "current" && "border-foreground bg-foreground text-background",
                  state === "complete" && "border-foreground text-foreground",
                  state === "pending" && "border-input text-muted-foreground",
                )}
                data-state={state}
              >
                {state === "complete" ? <CheckIcon /> : index + 1}
              </span>
              {index < last ? (
                <span
                  className={cn(
                    "h-px min-w-4 flex-1",
                    state === "complete" ? "bg-foreground" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>,
    slot,
  );
}
