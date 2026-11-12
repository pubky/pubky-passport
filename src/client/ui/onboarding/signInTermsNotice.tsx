const LINK_CLASS_NAME =
  "whitespace-nowrap rounded-sm font-semibold text-brand outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * The notice under the sign-in buttons, one paragraph: the consent, then the footer's own "powered
 * by" line. Continuing is the consent, so there is no checkbox. The links open in a new tab so
 * reading them does not lose a sign-in or an authorization in progress. While it is on the page the
 * footer is hidden (see globals.css): the notice and the Synonym badge under it already say what the
 * footer would.
 */
function SignInTermsNotice() {
  return (
    <div
      className="text-pretty text-xs font-medium leading-5 text-muted-foreground"
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
        , and confirm you are over 18. Pubky Passport is powered by the{" "}
        <a
          className={LINK_CLASS_NAME}
          href="https://pubky.org/"
          rel="noopener noreferrer"
          target="_blank"
        >
          Pubky protocol
        </a>
        . Built by Synonym Software, S.A. DE C.V. ©2026.
      </p>
    </div>
  );
}

export { SignInTermsNotice };
