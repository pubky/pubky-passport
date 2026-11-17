import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivacyPolicyPage from "./privacy-policy/page";
import TermsOfServicePage from "./terms-of-service/page";

describe("legal pages", () => {
  it.each([
    ["terms of service", TermsOfServicePage, "PUBKY PASSPORT TERMS AND CONDITIONS"],
    ["privacy policy", PrivacyPolicyPage, "PUBKY PASSPORT PRIVACY POLICY"],
  ])("renders the %s with the effective date and complete copy", (_, Page, heading) => {
    const markup = renderToStaticMarkup(<Page />);

    expect(markup).toContain(heading);
    expect(markup).toContain("Effective Date: November 17, 2026");
    expect(markup).not.toContain("[DATE]");
    expect(markup).not.toContain("[Legal:");
    expect(markup).not.toContain('aria-label="Legal documents"');
  });

  it("uses the approved privacy-policy wording for children and authorization sessions", () => {
    const markup = renderToStaticMarkup(<PrivacyPolicyPage />);

    expect(markup).toContain("Passport is meant for adults.");
    expect(markup).toContain("COPPA Information Request");
    expect(markup).toContain("receives the access you approved on your Homeserver");
    expect(markup).not.toContain("eligible minor");
  });

  it.each([
    [
      "terms of service",
      TermsOfServicePage,
      [
        "YOUR GOOGLE OR APPLE ACCOUNT",
        "Sign in with Apple and iCloud",
        "means the account you use to sign in to Apple services and iCloud",
        "or iCloud, if you sign in to Passport with Apple",
        "means the Google Account or Apple Account you use to sign in to Passport",
      ],
    ],
    [
      "privacy policy",
      PrivacyPolicyPage,
      [
        "Apple Account Information (browser only).",
        "private relay address",
        "With Apple.",
        "Google Drive or iCloud",
      ],
    ],
  ])("covers Sign in with Apple and iCloud in the %s", (_, Page, phrases) => {
    const markup = renderToStaticMarkup(<Page />);

    for (const phrase of phrases) expect(markup).toContain(phrase);
  });
});
