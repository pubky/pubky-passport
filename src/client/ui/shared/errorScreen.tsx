import { type ReactNode, useId, useLayoutEffect, useRef } from "react";

import { cn } from "./mergeClassNames";
import { PassportNavigation } from "./passportNavigation";
import { PassportScreen } from "./passportScreen";
import { DisplayHeading, LeadText, TEXT_MEASURE } from "./primitives/typography";

/** Codes that help support find a failure; people do not need them to recover. */
type TechnicalDetail = { code: string; detail?: string | undefined };

/**
 * The one layout for a screen that ends a step with a failure: the heading (with Passport's
 * brand accent, like every heading), the cause, the next step, optional context, the actions,
 * optional illustrated help, and technical details collapsed at the end. The heading takes
 * focus when the screen appears and is described by the cause and the next step, so screen
 * readers announce what went wrong and what to do in one go.
 */
function ErrorScreen({
  accent,
  action,
  back,
  cause,
  children,
  details,
  help,
  label,
  nextStep,
  secondaryAction,
  title,
  windowTitle,
}: {
  title: ReactNode;
  accent: ReactNode;
  /** The heading's accessible name when its visible text differs between viewports. */
  label?: string | undefined;
  /**
   * The window title, when the heading's own name would not do as one (it names the app by a
   * label the app chose; see `PassportScreen`).
   */
  windowTitle?: string | undefined;
  /** What went wrong, in plain words. */
  cause: ReactNode;
  /** What the person can do now; omit it when the actions alone say so. */
  nextStep?: ReactNode;
  /** Context the person needs to decide, such as the affected key. */
  children?: ReactNode;
  back?: ReactNode;
  /** The recovery action, such as Try again. */
  action?: ReactNode;
  /**
   * A further option under the navigation, such as a destructive restart: a text action (Button
   * `link` or `linkDestructive`) on the column's start edge.
   */
  secondaryAction?: ReactNode;
  /**
   * Illustrated help after the actions, such as the Drive permission guide. The actions come
   * first on screen and in focus order at every width, so they stay above a popup's fold.
   */
  help?: ReactNode;
  details?: TechnicalDetail | undefined;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const causeId = useId();
  const nextStepId = useId();
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-3">
        <DisplayHeading
          accent={accent}
          aria-describedby={nextStep ? `${causeId} ${nextStepId}` : causeId}
          aria-label={label}
          className="outline-none"
          data-window-title={windowTitle}
          ref={heading}
          tabIndex={-1}
        >
          {title}
        </DisplayHeading>
        <LeadText id={causeId}>{cause}</LeadText>
        {nextStep ? (
          <p className={cn("text-base font-medium leading-6", TEXT_MEASURE)} id={nextStepId}>
            {nextStep}
          </p>
        ) : null}
      </div>
      {children}
      {back || action || secondaryAction ? (
        <PassportNavigation
          back={back}
          className="mt-auto md:mt-0"
          confirm={action}
          tertiary={secondaryAction}
        />
      ) : null}
      {help}
      {details ? <TechnicalDetails {...details} /> : null}
    </PassportScreen>
  );
}

/** Error codes behind a closed disclosure, as text rather than a field-like box. */
function TechnicalDetails({ code, detail }: TechnicalDetail) {
  return (
    <details className="text-sm leading-5 text-muted-foreground">
      <summary className="w-fit cursor-pointer rounded-sm font-medium hover:text-foreground">
        Technical details
      </summary>
      <p className="mt-2">
        Error code:{" "}
        <code className="font-mono text-xs text-foreground [overflow-wrap:anywhere]">{code}</code>
        {detail ? (
          <>
            {" · "}
            <code className="font-mono text-xs text-foreground [overflow-wrap:anywhere]">
              {detail}
            </code>
          </>
        ) : null}
      </p>
    </details>
  );
}

export { ErrorScreen, TechnicalDetails, type TechnicalDetail };
