import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { SquareUserRoundIcon } from "./icons";
import { SavedIdentitySummary } from "./identitySummary";
import { Button } from "./primitives/button";

export function SelectedIdentity({
  identity,
  onSwitch,
  disabled = false,
}: {
  identity?: LocalIdentityMetadata | undefined;
  /** Opens the list of identities to pick another; absent when there is no other one to pick. */
  onSwitch?: (() => void) | undefined;
  disabled?: boolean;
}) {
  return (
    <section
      aria-label="Selected identity"
      className="@container flex min-w-0 flex-wrap items-center gap-3 rounded-2xl bg-card p-4"
    >
      {/* The basis keeps the name, key and account readable: below it the button wraps. */}
      <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
        {identity ? (
          // The tag beside the key, as in the identity list.
          <SavedIdentitySummary attachmentInline identity={identity} />
        ) : (
          <span className="text-sm text-muted-foreground">No local identity available</span>
        )}
      </div>
      {onSwitch ? (
        <Button
          className="@max-[21rem]:w-full"
          disabled={disabled}
          onClick={onSwitch}
          size="sm"
          variant="secondary"
        >
          <SquareUserRoundIcon />
          Switch <span className="sr-only">identity</span>
        </Button>
      ) : null}
    </section>
  );
}
