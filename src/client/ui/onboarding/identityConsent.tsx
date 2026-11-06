import { cn } from "@/client/ui/shared/mergeClassNames";

const LINK_CLASS_NAME =
  "rounded-sm font-semibold text-foreground underline decoration-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * The consent line under the sign-in buttons that create an identity. The links open in a new
 * tab so reading them does not lose a sign-in or an authorization in progress.
 */
function IdentityConsent({ className }: { className?: string }) {
  return (
    <p className={cn("text-sm font-medium leading-5 text-muted-foreground", className)}>
      By continuing, you confirm you are 18 or older and agree to the{" "}
      <a
        className={LINK_CLASS_NAME}
        href="/terms-of-service"
        rel="noopener noreferrer"
        target="_blank"
      >
        Terms
      </a>{" "}
      and{" "}
      <a
        className={LINK_CLASS_NAME}
        href="/privacy-policy"
        rel="noopener noreferrer"
        target="_blank"
      >
        Privacy Policy
      </a>
      .
    </p>
  );
}

export { IdentityConsent };
