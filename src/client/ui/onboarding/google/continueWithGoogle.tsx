import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { Button } from "@/client/ui/shared/primitives/button";

/** The "Continue with Google" sign-in pill. */
function ContinueWithGoogle({ onContinue }: { onContinue: () => void }) {
  return (
    <Button className="w-full" onClick={onContinue} size="lg" type="button" variant="secondary">
      <span aria-hidden="true" className="flex size-5 items-center justify-center">
        <GoogleLogo />
      </span>
      Continue with Google
    </Button>
  );
}

export { ContinueWithGoogle };
