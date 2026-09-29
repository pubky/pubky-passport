"use client";

import { createContext, type ReactNode, useContext } from "react";
import { CheckIcon } from "./icons";
import { cn } from "./mergeClassNames";

/** Account creation with a key held by the person: in this browser or in Pubky Ring. */
export const ACCOUNT_SETUP_STEPS = ["Account", "Keys", "Profile"] as const;
/** Account creation with Continue with Google, where Google holds the encrypted backup. */
export const GOOGLE_SETUP_STEPS = ["Google backup", "Profile"] as const;

type Progress = { steps: readonly string[]; current: number };
const Context = createContext<Progress | null>(null);

/** Marks every PassportScreen inside it as one step of a multi-screen setup flow. */
export function SetupProgressProvider({
  children,
  steps,
  current,
}: Progress & { children: ReactNode }) {
  return <Context value={{ steps, current }}>{children}</Context>;
}

/**
 * Renders the surrounding flow's progress; nothing outside a SetupProgressProvider. It keeps one
 * width and position whatever the width of the screen it heads, so its steps never move while
 * the flow goes on. Labels take no width of their own, so the line between two steps starts and
 * ends at their circles however long a label is.
 */
export function SetupProgress() {
  const progress = useContext(Context);
  if (!progress) return null;
  const last = progress.steps.length - 1;
  return (
    <nav aria-label="Account setup progress" className="mx-auto mb-2 w-full max-w-[588px]">
      <ol className="flex items-start">
        {progress.steps.map((label, index) => {
          const state =
            index < progress.current
              ? "complete"
              : index === progress.current
                ? "current"
                : "pending";
          const edge = index === 0 ? "start" : index === last ? "end" : "center";
          return (
            <li
              key={label}
              aria-current={state === "current" ? "step" : undefined}
              className="flex min-w-0 flex-1 items-start last:flex-none"
            >
              <div
                className={cn(
                  "flex flex-col gap-2",
                  edge === "start" ? "items-start" : edge === "end" ? "items-end" : "items-center",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full border text-sm font-bold",
                    state === "current" && "border-foreground bg-foreground text-background",
                    state === "complete" && "border-foreground text-foreground",
                    state === "pending" && "border-input text-muted-foreground",
                  )}
                >
                  {state === "complete" ? (
                    <>
                      <CheckIcon />
                      <span className="sr-only">Completed: </span>
                    </>
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    // No width of its own: the label runs on from its circle's edge, or centre.
                    "flex h-4 w-0 whitespace-nowrap text-xs leading-4",
                    edge === "start"
                      ? "justify-start"
                      : edge === "end"
                        ? "justify-end"
                        : "justify-center",
                    state === "current" ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </div>
              {index < last ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-4 h-px flex-1",
                    state === "complete" ? "bg-foreground" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
