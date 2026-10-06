import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { UserRoundPlusIcon } from "@/client/ui/shared/icons";
import { OrDivider } from "@/client/ui/shared/orDivider";
import { Button } from "@/client/ui/shared/primitives/button";

/**
 * The other ways to answer a request, below an "or": the start page for an identity that is not
 * saved here yet, and Pubky Ring, which gets the request unchanged. The identity list and the
 * permission review both end with it, so neither is a dead end for someone whose identity is
 * elsewhere, and neither action competes with the screen's own (a row, or Authorize).
 */
export function OtherWaysIn({
  disabled = false,
  onOpenRing,
  onUseAnotherIdentity,
}: {
  /** While an answer is on its way, nothing else can start. */
  disabled?: boolean;
  onOpenRing: () => void;
  /** Opens the start page: create an account, Google or a recovery file. */
  onUseAnotherIdentity: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 [@media(max-height:50rem)]:gap-3">
      <OrDivider />
      {/* A narrower inset keeps "Continue with Pubky Ring" on one line beside Use another
          identity in the app's 520px popup. */}
      <div className="grid gap-3 min-[30rem]:grid-cols-2">
        <Button
          className="w-full px-4"
          disabled={disabled}
          onClick={onUseAnotherIdentity}
          size="lg"
          variant="secondary"
        >
          <UserRoundPlusIcon /> Use another identity
        </Button>
        <Button
          className="w-full px-4"
          disabled={disabled}
          onClick={onOpenRing}
          size="lg"
          variant="secondary"
        >
          <PubkyBrandIcon /> Continue with Pubky Ring
        </Button>
      </div>
    </div>
  );
}
