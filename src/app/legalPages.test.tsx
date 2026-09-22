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
    expect(markup).toContain("Effective Date: September 21, 2026");
    expect(markup).not.toContain("[DATE]");
    expect(markup).not.toContain("[Legal:");
    expect(markup).not.toContain('aria-label="Legal documents"');
  });

  it("uses the approved privacy-policy wording for children and authorization sessions", () => {
    const markup = renderToStaticMarkup(<PrivacyPolicyPage />);

    expect(markup).toContain("Passport is meant for adults.");
    expect(markup).toContain("COPPA Information Request");
    expect(markup).toContain("Public Session containing your public key");
    expect(markup).not.toContain("eligible minor");
  });
});
