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
    expect(markup).toContain("Pubky session containing your public key");
    expect(markup).not.toContain("not the information described in this Policy");
    expect(markup).not.toContain("eligible minor");
  });

  it("matches what the product does in the privacy policy", () => {
    const markup = renderToStaticMarkup(<PrivacyPolicyPage />);

    // Homegate keeps an Argon2id peppered hash of issuer and subject, the signup code and the time.
    expect(markup).toContain("peppered hash derived from the assertion’s issuer and account");
    expect(markup).toContain("our verification service");
    expect(markup).not.toContain("keeps counters");
    expect(markup).not.toContain("There is no Passport user database.");
    expect(markup).not.toContain("which is server logs and any message you send us");
    expect(markup).toContain("account-creation verification records");

    // Recovery file download and import both ask for a password, processed in the browser.
    expect(markup).not.toContain("Passwords, recovery phrases, or payment credentials.");
    expect(markup).toContain("download or import an encrypted recovery file");

    // Visible copies exist in Google Drive only; iCloud holds one private CloudKit record.
    expect(markup).toContain("Visible copies exist in Google Drive only");
    expect(markup).not.toContain("Passport File, and any visible recovery copies Passport writes");

    // “Sold” and “shared” are CCPA terms.
    expect(markup).not.toContain("defined by the California Consumer Privacy Act (“CCPA”) or the");
  });

  it("limits visible copies to Google Drive in the terms of service", () => {
    const markup = renderToStaticMarkup(<TermsOfServicePage />);

    expect(markup).toContain("visible folder in your Google Drive");
    expect(markup).not.toContain("visible folder in your Cloud Storage");
  });

  it.each([
    ["terms of service", TermsOfServicePage],
    ["privacy policy", PrivacyPolicyPage],
  ])("keeps a space after inline bold headings in the %s", (_, Page) => {
    const markup = renderToStaticMarkup(<Page />);

    expect(markup).not.toMatch(/:<\/strong>\w/);
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
