import type { ReactNode } from "react";

import { BrandEndorsement } from "@/client/ui/shared/brand/brandEndorsement";
import { ContinueWithApple } from "./apple/continueWithApple";
import { ContinueWithGoogle } from "./google/continueWithGoogle";
import { SignInTermsNotice } from "./signInTermsNotice";

/**
 * Shared provider choice, in the same order on every screen, with the Terms notice and the Synonym
 * badge under it. `secondary` (the import link, then Back when shown) sits between the buttons and the notice. The page footer steps aside while the notice is shown (see globals.css).
 */
function ProviderChoice({
  apple,
  onContinueWithGoogle,
  secondary,
}: {
  apple: { ready: boolean; onContinue: () => void } | null;
  onContinueWithGoogle: () => void;
  secondary?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {apple ? (
        <div
          aria-label="Choose an account to sign in with"
          className="flex flex-col gap-3"
          role="group"
        >
          <ContinueWithGoogle onContinue={onContinueWithGoogle} />
          <ContinueWithApple disabled={!apple.ready} onContinue={apple.onContinue} />
        </div>
      ) : (
        <ContinueWithGoogle onContinue={onContinueWithGoogle} />
      )}
      {secondary}
      <SignInTermsNotice />
      <BrandEndorsement className="self-start" />
    </div>
  );
}

export { ProviderChoice };
