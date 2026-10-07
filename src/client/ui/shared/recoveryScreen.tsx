import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./mergeClassNames";
import { OnboardingCard } from "./onboardingCard";
import { PassportScreen } from "./passportScreen";
import { DisplayHeading, LeadText, TEXT_MEASURE } from "./primitives/typography";

type RecoveryScreenProps = { description: ReactNode; children: ReactNode } & (
  | {
      /** A step of the backup, import or key setup: the display heading every step uses. */
      variant?: "step";
      title: string;
      /** The heading's last words, in the brand accent. */
      accent: string;
    }
  | {
      /** A question to confirm, such as logging out: a card that reads as a dialog. */
      variant: "confirm";
      title: string;
      accent?: never;
    }
);

/**
 * A whole-screen step of backing up, importing or setting up a key, or a confirmation such as
 * logging out. Each new heading is a new step: the screen remounts and focus moves to its heading
 * so screen readers announce it. Steps lay their fields out in a RecoveryCard, with the actions
 * under it, like the other setup steps.
 */
export function RecoveryScreen(props: RecoveryScreenProps) {
  const { children, description, title } = props;
  const accent = props.variant === "confirm" ? undefined : props.accent;
  const heading = useRef<HTMLHeadingElement>(null);
  const name = accent ? `${title} ${accent}` : title;
  // Each step replaces the whole screen; announce the new heading instead of losing focus.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [name]);
  if (accent === undefined) {
    return (
      <PassportScreen key={name} className="gap-6">
        {/* Across the track like every card from md, its question and answers kept to a
            readable column on the card's start edge. */}
        <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-popover p-6 sm:p-8 md:p-12">
          <div className={cn("flex min-w-0 flex-col gap-6", TEXT_MEASURE)}>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold leading-8 outline-none" ref={heading} tabIndex={-1}>
                {title}
              </h1>
              <p className="text-sm leading-5 text-muted-foreground">{description}</p>
            </div>
            {children}
          </div>
        </section>
      </PassportScreen>
    );
  }
  return (
    <PassportScreen key={name} className="gap-6 md:gap-8">
      <div className="flex flex-col gap-3">
        <DisplayHeading
          accent={accent}
          className="outline-none [&>span]:inline"
          ref={heading}
          tabIndex={-1}
        >
          {title}
        </DisplayHeading>
        <LeadText>{description}</LeadText>
      </div>
      {children}
    </PassportScreen>
  );
}

/**
 * A recovery step's fields. From md they sit in a card across the track, beside the concept's
 * illustration from lg, in the column account creation's cards keep their fields to (as the phone
 * and invite steps); below md, where the illustration is hidden, they sit on the page as in v1,
 * which keeps the step's primary action within the app's 760px sign-in popup.
 */
export function RecoveryCard({
  children,
  illustration,
}: {
  children: ReactNode;
  illustration?: string | undefined;
}) {
  return (
    <OnboardingCard
      className="max-md:bg-transparent max-md:p-0"
      {...(illustration ? { illustration } : {})}
    >
      {children}
    </OnboardingCard>
  );
}
