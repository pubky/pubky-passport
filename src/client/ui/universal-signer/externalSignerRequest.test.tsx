/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalSignerRequest } from "./externalSignerRequest";

const LARGE_REQUEST = `pubkyauth://signin?secret=s&caps=${Array.from(
  { length: 6 },
  (_, index) => `/pub/${"a".repeat(240)}/${"b".repeat(240)}/app${index}/:rw`,
).join(",")}`;

afterEach(cleanup);

describe("ExternalSignerRequest", () => {
  it("offers only opening Ring for an app request too large for a QR code", () => {
    render(<ExternalSignerRequest getAuthorizationUrl={() => LARGE_REQUEST} />);
    expect(
      screen.getByText(
        "This request is too big for a QR code. Open it in Pubky Ring on this device.",
      ),
    ).toBeTruthy();
    // A Ring identity has no Authorize action, so the hint must not point to one.
    expect(screen.queryByText(/Authorize in Passport/u)).toBeNull();
    expect(screen.queryByRole("img", { name: "Pubky authorization QR code" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Pubky Ring" }).getAttribute("href")).toBe(
      LARGE_REQUEST,
    );
  });

  it("labels a profile connection as its own", () => {
    render(
      <ExternalSignerRequest
        getAuthorizationUrl={() => LARGE_REQUEST}
        purpose="profile-connection"
      />,
    );
    expect(
      screen.getByText(
        "This connection request is too big for a QR code. Open it in Pubky Ring on this device.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "Pubky Ring profile connection" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connect in Pubky Ring" }).getAttribute("href")).toBe(
      LARGE_REQUEST,
    );
  });
});
