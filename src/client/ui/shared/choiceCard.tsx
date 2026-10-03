import Image from "next/image";
import { type ReactNode, useId } from "react";

import { cn } from "./mergeClassNames";

/**
 * One option on a screen that asks the person to choose, such as where a key lives, laid out as
 * pubky.app lays out its sign-in cards: from lg, the concept's illustration in a fixed left column,
 * top-aligned with the content; beside it one left-aligned stack of the option's name (the card's
 * heading), one line on what it means, and then its actions. Two cards side by side share their
 * padding, column widths and the lines of their headings and descriptions, and the grid stretches
 * them to one height. The card sizes its illustration for its own width, not the window's: 96px
 * below 36rem (a half of a 1024px window), 144px from 36rem (the 588px step column, or a half of a
 * wide screen). `split` is the start page's pair, sized like pubky.app/sign-in: from 36rem the
 * illustration takes what the content column (18rem, so no button label wraps) leaves of the
 * card, about half of it, 48px from the content. Below lg there is no illustration and the stack
 * fills the card. Corners are 8px, as on pubky.app.
 */
export function ChoiceCard({
  children,
  compact = false,
  dense = false,
  description,
  illustration,
  recommendationId,
  split = false,
  title,
}: {
  /** The card's actions, and any note that belongs right above them. */
  children: ReactNode;
  /**
   * In a short window, such as an app's 760px popup, the card keeps its name and actions only
   * (tighter padding, no description), so a request's first step stays in view.
   */
  compact?: boolean;
  /**
   * Less padding and no extra space under the description, for a page whose two cards carry
   * enough (four ways in, or a QR code with its status) that the first screen must stay tight.
   */
  dense?: boolean;
  description: ReactNode;
  illustration: string;
  /**
   * Marks the recommended option with a chip carrying this id, so its button can reference it
   * with `aria-describedby` and moving between buttons still hears it.
   */
  recommendationId?: string | undefined;
  /**
   * The start page's two cards: from 36rem a large illustration, about half the card. Assumes
   * `dense` (24px padding), which the content column's 18rem is measured against.
   */
  split?: boolean;
  title: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="@container flex min-w-0 flex-col rounded-md bg-card"
    >
      <div
        className={cn(
          "flex flex-1 gap-6 p-6",
          split ? "@xl:gap-12" : "@xl:gap-8",
          !dense && "lg:p-8",
          compact && "[@media(max-height:50rem)]:p-4",
        )}
      >
        <Image
          alt=""
          aria-hidden="true"
          src={illustration}
          width={split ? 256 : 144}
          height={split ? 256 : 144}
          // Top-aligned with the heading, in a column of its own that both cards share. Split,
          // it is the card less its padding (2 x 24px), the gap (48px) and the content (18rem):
          // 204px in a 588px card, never more than 16rem.
          className={cn(
            "hidden size-24 shrink-0 self-start object-contain lg:block",
            split ? "@xl:size-[min(16rem,calc(100cqw-24rem))]" : "@xl:size-36",
          )}
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
          <p
            className={cn(
              "text-sm leading-5 text-muted-foreground",
              !dense && "mb-3",
              compact && "[@media(max-height:50rem)]:hidden",
            )}
          >
            {description}
          </p>
          {/* The actions follow what the option means, as on pubky.app, not pushed to the bottom. */}
          <div className="flex flex-col gap-3">{children}</div>
        </div>
      </div>
    </section>
  );
}
