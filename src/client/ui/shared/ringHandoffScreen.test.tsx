/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PassportNavigation } from "./passportNavigation";
import { Button } from "./primitives/button";
import { RingHandoffScreen, RingHandoffStatus } from "./ringHandoffScreen";

function renderScreen(status?: React.ReactNode) {
  render(
    <RingHandoffScreen
      action="Connect"
      instruction="Approve in Pubky Ring."
      navigation={<PassportNavigation back={<Button>Back</Button>} />}
      status={status}
    >
      <section aria-label="Hand-off">QR code</section>
    </RingHandoffScreen>,
  );
}

describe("RingHandoffScreen", () => {
  afterEach(cleanup);

  it("lays every Ring hand-off out the same way, ending with where to get Pubky Ring", () => {
    renderScreen(
      <RingHandoffStatus waiting>Waiting for approval in Pubky Ring…</RingHandoffStatus>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Connect Pubky Ring." });
    const parts = [
      heading,
      screen.getByText("Approve in Pubky Ring."),
      screen.getByRole("region", { name: "Hand-off" }),
      screen.getByRole("status"),
      screen.getByRole("button", { name: "Back" }),
      screen.getByText("Don't have Pubky Ring?"),
      screen.getByRole("link", { name: "Get Pubky Ring on Google Play" }),
    ];
    for (const [earlier, later] of parts
      .slice(0, -1)
      .map((part, index) => [part, parts[index + 1]!]))
      expect(
        earlier!.compareDocumentPosition(later!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    // Store pages open beside Passport, so the hand-off stays where it was.
    expect(
      screen.getByRole("link", { name: "Download Pubky Ring on the App Store" }),
    ).toHaveAttribute("target", "_blank");
  });

  it("spins only while Passport itself waits for Pubky Ring", () => {
    renderScreen(
      <RingHandoffStatus waiting>Waiting for approval in Pubky Ring…</RingHandoffStatus>,
    );
    const waiting = screen.getByRole("status");
    expect(waiting.querySelector('[data-slot="spinner"]')).not.toBeNull();
    // It can take focus, e.g. once a retried request waits again.
    waiting.focus();
    expect(waiting).toHaveFocus();
    cleanup();

    renderScreen(<RingHandoffStatus>Once you approve, the app signs you in.</RingHandoffStatus>);
    expect(screen.getByRole("status").querySelector('[data-slot="spinner"]')).toBeNull();
    cleanup();

    renderScreen();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
