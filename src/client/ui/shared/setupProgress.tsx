"use client";

import { createContext, type ReactNode, useContext } from "react";
import { CheckIcon } from "./icons";
import { cn } from "./mergeClassNames";

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

/** Renders the surrounding flow's progress; nothing outside a SetupProgressProvider. */
export function SetupProgress() {
  const progress = useContext(Context);
  if (!progress) return null;
  return (
    <nav aria-label="Account setup progress" className="mb-2 w-full">
      <ol className="flex items-start">
        {progress.steps.map((label, index) => {
          const state =
            index < progress.current
              ? "complete"
              : index === progress.current
                ? "current"
                : "pending";
          return (
            <li
              key={label}
              aria-current={state === "current" ? "step" : undefined}
              className="flex min-w-0 flex-1 items-start last:flex-none"
            >
              <div className="flex flex-col items-center gap-2">
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
                    "text-xs",
                    state === "current" ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </div>
              {index < progress.steps.length - 1 ? (
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
