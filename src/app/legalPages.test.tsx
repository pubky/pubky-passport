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
    expect(markup).toContain("Effective Date: November 6, 2026");
    expect(markup).not.toContain("[DATE]");
    expect(markup).not.toContain("[Legal:");
    expect(markup).not.toContain('aria-label="Legal documents"');
  });

  it("uses the approved privacy-policy wording for children and authorization sessions", () => {
    const markup = renderToStaticMarkup(<PrivacyPolicyPage />);

    expect(markup).toContain("Passport is meant for adults.");
    expect(markup).toContain("COPPA Information Request");
    expect(markup).toContain("Pubky session containing your public key");
    expect(markup).not.toContain("eligible minor");
  });

  it("limits Passport to adults in the terms", () => {
    const markup = renderToStaticMarkup(<TermsOfServicePage />);

    expect(markup).toContain("you must be at least eighteen (18) years old");
    expect(markup).toContain("Passport is for adults only");
    expect(markup).not.toContain("permission of a parent or legal guardian");
  });

  it.each([
    ["terms of service", TermsOfServicePage, "YOUR APPLE ACCOUNT"],
    ["privacy policy", PrivacyPolicyPage, "In your iCloud."],
  ])("describes Apple and iCloud next to Google in the %s", (_, Page, appleSection) => {
    const markup = renderToStaticMarkup(<Page />);

    expect(markup).toContain(appleSection);
    expect(markup).toContain("Detach from Apple");
    expect(markup).toContain("asks Apple for your name and email address");
    expect(markup).not.toContain("Apple ID");
  });

  it("keeps Apple name and email in the browser like the Google profile", () => {
    const markup = renderToStaticMarkup(<PrivacyPolicyPage />);

    expect(markup).toContain("Apple Account Information (browser only).");
    expect(markup).toContain("Apple does not provide a profile picture.");
    expect(markup).toContain("Your name is never sent to us.");
  });
});
