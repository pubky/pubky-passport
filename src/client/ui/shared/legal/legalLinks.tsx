"use client";

import { cn } from "@/client/ui/shared/mergeClassNames";
import { usePendingRequest } from "@/client/ui/shared/usePendingRequest";

const LINK_CLASS_NAME =
  "rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";

const CONSENT_LINK_CLASS_NAME =
  "rounded-sm font-medium text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand";

/**
 * While a request waits, the legal pages open in a new tab: reading the terms before approving
 * must not navigate the app's popup away and drop its request. Once it has its answer, they open
 * in the tab again. The link's name then says so; an `aria-label` rather than hidden text, so no
 * visible space trails the link inside a sentence.
 */
function useLegalLinkTarget() {
  const request = usePendingRequest();
  return (name: string) =>
    request
      ? ({
          "aria-label": `${name} (opens in a new tab)`,
          rel: "noopener noreferrer",
          target: "_blank",
        } as const)
      : {};
}

/** Passport's Terms of Service and Privacy Policy, as the footer links them on every page. */
function LegalLinks({ className }: { className?: string }) {
  const linkTo = useLegalLinkTarget();
  return (
    <nav aria-label="Legal" className={cn("flex items-center gap-4", className)}>
      <a className={LINK_CLASS_NAME} href="/terms-of-service" {...linkTo("Terms of Service")}>
        Terms of Service
      </a>
      <a className={LINK_CLASS_NAME} href="/privacy-policy" {...linkTo("Privacy Policy")}>
        Privacy Policy
      </a>
    </nav>
  );
}

/**
 * What creating an account agrees to, under the ways to create one (Join, Verify, the Google
 * screen, a request's Sign in), as pubky.app's onboarding says it: the same two pages as the
 * footer, and the age those terms require.
 */
function LegalConsent({ className }: { className?: string }) {
  const linkTo = useLegalLinkTarget();
  return (
    <p className={cn("text-sm leading-5 text-muted-foreground", className)}>
      By joining and creating a Pubky account, you agree to the{" "}
      <a
        className={CONSENT_LINK_CLASS_NAME}
        href="/terms-of-service"
        {...linkTo("Terms of Service")}
      >
        Terms of Service
      </a>{" "}
      and{" "}
      <a className={CONSENT_LINK_CLASS_NAME} href="/privacy-policy" {...linkTo("Privacy Policy")}>
        Privacy Policy
      </a>
      , and confirm you are at least 18 years old.
    </p>
  );
}

export { LegalConsent, LegalLinks };
