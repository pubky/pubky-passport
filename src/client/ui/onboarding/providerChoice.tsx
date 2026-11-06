import { useId } from "react";

import { ContinueWithApple } from "./apple/continueWithApple";
import { ContinueWithGoogle } from "./google/continueWithGoogle";

/**
 * The sign-in providers Passport offers. With Apple on, a short line says the buttons are
 * alternatives, and Apple's button comes first at the same width and height as Google's, as
 * Apple's guidelines ask. With only Google, it is Google's button alone.
 */
function ProviderChoice({
  apple,
  onContinueWithGoogle,
}: {
  apple: { ready: boolean; onContinue: () => void } | null;
  onContinueWithGoogle: () => void;
}) {
  const labelId = useId();
  if (!apple) return <ContinueWithGoogle onContinue={onContinueWithGoogle} />;
  return (
    <div aria-labelledby={labelId} className="flex flex-col gap-3" role="group">
      <p className="text-sm leading-5 text-muted-foreground" id={labelId}>
        Choose an account to sign in with
      </p>
      <ContinueWithApple disabled={!apple.ready} onContinue={apple.onContinue} />
      <ContinueWithGoogle onContinue={onContinueWithGoogle} />
    </div>
  );
}

export { ProviderChoice };
