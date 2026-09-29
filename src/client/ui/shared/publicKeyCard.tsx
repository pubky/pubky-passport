import { copyToClipboard, PUBKY_COPY_TOASTS } from "./copyToClipboard";
import { CopyIcon, KeyRoundIcon } from "./icons";
import { OnboardingCard } from "./onboardingCard";
import { Button } from "./primitives/button";

export function PublicKeyCard({ publicKey }: { publicKey: string }) {
  return (
    <OnboardingCard illustration="/illustrations/identity-key.png">
      <h2 className="text-xl font-bold leading-7">Your pubky</h2>
      <div className="flex min-w-0 items-center gap-3 rounded-lg border border-brand bg-black/10 px-4 py-4 text-brand">
        <KeyRoundIcon />
        <p className="min-w-0 select-all break-all text-sm font-medium leading-5">{publicKey}</p>
      </div>
      <Button
        className="w-full md:w-fit"
        variant="secondary"
        onClick={() => void copyToClipboard(publicKey, PUBKY_COPY_TOASTS)}
      >
        <CopyIcon />
        Copy to clipboard
      </Button>
    </OnboardingCard>
  );
}
