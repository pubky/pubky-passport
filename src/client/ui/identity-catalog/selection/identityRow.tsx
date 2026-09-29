import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { CheckIcon } from "@/client/ui/shared/icons";
import { SavedIdentitySummary } from "@/client/ui/shared/identitySummary";
import { cn } from "@/client/ui/shared/mergeClassNames";

type IdentityRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  identity: LocalIdentityMetadata;
  selected?: boolean;
  /** Shown at the end of the row when it is not the selected one, e.g. a "continue" arrow. */
  trailing?: ReactNode;
};

function IdentityRow({ className, identity, selected, trailing, ...props }: IdentityRowProps) {
  return (
    <button
      // Choosing a row switches to that identity; it toggles nothing, so the active row is the
      // current item of its list rather than a pressed button.
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group flex min-h-18 w-full items-center gap-2 rounded-2xl border border-transparent bg-card px-4 py-3 text-left transition-colors hover:bg-accent aria-[current=true]:border-brand/64",
        className,
      )}
      type="button"
      {...props}
    >
      <SavedIdentitySummary
        // A tag beside the key keeps rows short, so a list shows more of them.
        attachmentInline
        detailClassName="group-hover:text-secondary-foreground group-focus-visible:text-secondary-foreground"
        identity={identity}
      />
      {selected ? <CheckIcon className="text-brand" /> : trailing}
    </button>
  );
}

export { IdentityRow };
