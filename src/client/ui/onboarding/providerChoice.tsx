import { ContinueWithApple } from "./apple/continueWithApple";
import { ContinueWithGoogle } from "./google/continueWithGoogle";

/** Shared provider choice, in the same order on every screen. */
function ProviderChoice({
  apple,
  onContinueWithGoogle,
}: {
  apple: { ready: boolean; onContinue: () => void } | null;
  onContinueWithGoogle: () => void;
}) {
  if (!apple) return <ContinueWithGoogle onContinue={onContinueWithGoogle} />;
  return (
    <div
      aria-label="Choose an account to sign in with"
      className="flex flex-col gap-3"
      role="group"
    >
      <ContinueWithGoogle onContinue={onContinueWithGoogle} />
      <ContinueWithApple disabled={!apple.ready} onContinue={apple.onContinue} />
    </div>
  );
}

export { ProviderChoice };
