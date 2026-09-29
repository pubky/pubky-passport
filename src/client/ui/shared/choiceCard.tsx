import Image from "next/image";
import { type ReactNode, useId } from "react";

/**
 * One option on a screen that asks the person to choose, such as where a key lives: the concept's
 * illustration (from lg), the option's name as the card's heading, what it means, and its actions
 * stacked at full width. Side by side, both headings start at the top and both actions sit at the
 * bottom, whatever wraps in between. The card lays itself out for its own width, not the window's:
 * from 36rem the illustration moves beside the text, whether the card fills the 588px step column
 * or half of a wide screen. Beside the text, the illustration and spacing stay small (144px, a
 * 32px gap and the lg padding), leaving the text column room for a label such as "Continue with
 * Google" on one line, so the first screen does not scroll at 1280x800.
 */
export function ChoiceCard({
  children,
  description,
  illustration,
  recommendationId,
  title,
}: {
  /** The card's actions, and any note that belongs right above them. */
  children: ReactNode;
  description: ReactNode;
  illustration: string;
  /**
   * Marks the recommended option with a chip carrying this id, so its button can reference it
   * with `aria-describedby` and moving between buttons still hears it.
   */
  recommendationId?: string | undefined;
  title: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="@container flex min-w-0 flex-col rounded-lg bg-card"
    >
      <div className="flex flex-1 flex-col gap-6 p-6 lg:p-8 @xl:flex-row @xl:gap-8">
        <Image
          alt=""
          aria-hidden="true"
          src={illustration}
          width={192}
          height={192}
          className="hidden size-48 shrink-0 object-contain lg:block @xl:size-36 @xl:self-center"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* The chip sits beside the heading, so the card keeps the heading as its name. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-2xl font-bold leading-8" id={headingId}>
              {title}
            </h2>
            {recommendationId ? (
              <span
                className="rounded-full bg-brand/16 px-2 py-0.5 text-xs font-bold uppercase leading-4 tracking-[0.05em] text-brand"
                id={recommendationId}
              >
                Recommended
              </span>
            ) : null}
          </div>
          <p className="mb-3 text-sm leading-5 text-muted-foreground">{description}</p>
          <div className="mt-auto flex flex-col gap-3">{children}</div>
        </div>
      </div>
    </section>
  );
}
