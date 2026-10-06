import { copyToClipboard, PUBKY_COPY_TOASTS } from "./copyToClipboard";
import { BALANCED_KEY_CLASS, BalancedKeyText } from "./balancedKey";
import { cn } from "./mergeClassNames";
import { CopyIcon, KeyRoundIcon } from "./icons";
import { OnboardingCard } from "./onboardingCard";
import { Button } from "./primitives/button";

/**
 * A new identity's pubky, shown whole: on one line where it fits, else in two equal halves, so
 * the 52 characters never leave a few on a line of their own. Copy sits beside the heading rather
 * than on a row of its own; short windows tighten the padding, keeping the screen's way on inside
 * an app's popup.
 */
export function PublicKeyCard({ publicKey }: { publicKey: string }) {
  return (
    <OnboardingCard
      className="[@media(max-height:50rem)]:py-4"
      illustration="/illustrations/identity-key.png"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold leading-7">Your pubky</h2>
        <Button
          aria-label="Copy pubky"
          onClick={() => void copyToClipboard(publicKey, PUBKY_COPY_TOASTS)}
          size="sm"
          variant="secondary"
        >
          <CopyIcon />
          Copy
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-3 rounded-lg border border-brand bg-black/10 px-4 py-4 text-brand [@media(max-height:50rem)]:py-3">
        <KeyRoundIcon />
        <p className={cn("min-w-0 select-all text-sm font-medium leading-5", BALANCED_KEY_CLASS)}>
          <BalancedKeyText value={publicKey} />
        </p>
      </div>
    </OnboardingCard>
  );
}
