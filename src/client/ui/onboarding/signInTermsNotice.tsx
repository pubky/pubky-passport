const LINK_CLASS_NAME =
  "whitespace-nowrap rounded-sm font-semibold text-brand underline decoration-brand/40 underline-offset-4 outline-none hover:decoration-brand focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * The notice under the sign-in buttons. Continuing is the consent, so there is no checkbox. The
 * links open in a new tab so reading them does not lose a sign-in or an authorization in progress.
 * While it is on the page the footer hides its own "powered by" line (see globals.css).
 */
function SignInTermsNotice() {
  return (
    <div
      className="flex flex-col gap-2 text-pretty text-xs font-medium leading-5 text-muted-foreground"
      data-passport-sign-in-notice=""
    >
      <p>
        By continuing, you agree to the Pubky Passport{" "}
        <a
          className={LINK_CLASS_NAME}
          href="/terms-of-service"
          rel="noopener noreferrer"
          target="_blank"
        >
          Terms of Service
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
        , and confirm you are over 18.
      </p>
      <p>
        Pubky Passport is powered by the Pubky protocol. Built by Synonym Software, S.A. DE C.V.
      </p>
    </div>
  );
}

export { SignInTermsNotice };
