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
        "This request is too big for a QR code. Open it in your keychain app on this device.",
      ),
    ).toBeTruthy();
    // A Ring identity has no Authorize action, so the hint must not point to one.
    expect(screen.queryByText(/Authorize in Passport/u)).toBeNull();
    expect(screen.queryByRole("img", { name: "Pubky authorization QR code" })).toBeNull();
    expect(screen.getByRole("region", { name: "Sign in with your keychain" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open keychain app" }).getAttribute("href")).toBe(
      LARGE_REQUEST,
    );
  });

  it("names only Pubky Ring for an app's legacy cookie request", () => {
    render(
      <ExternalSignerRequest
        getAuthorizationUrl={() => LARGE_REQUEST}
        purpose="app-request-ring"
      />,
    );
    // Bitkit refuses the legacy kind, so nothing points to another keychain app.
    expect(
      screen.getByText(
        "This request is too big for a QR code. Open it in Pubky Ring on this device.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "Sign in with Pubky Ring" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Pubky Ring" }).getAttribute("href")).toBe(
      LARGE_REQUEST,
    );
    expect(screen.queryByText(/keychain/u)).toBeNull();
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
        "This connection request is too big for a QR code. Open it in your keychain app on this device.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "Keychain connection" })).toBeTruthy();
    // Every way to open the keychain says the same; the region and the code tell the requests
    // apart.
    expect(screen.getByRole("link", { name: "Open keychain app" }).getAttribute("href")).toBe(
      LARGE_REQUEST,
    );
  });
});
