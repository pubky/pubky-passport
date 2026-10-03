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

  it("lays every Ring hand-off out the same way, leaving where to get Pubky Ring to its card", () => {
    renderScreen(<RingHandoffStatus>Once you approve, the app signs you in.</RingHandoffStatus>);

    const heading = screen.getByRole("heading", { level: 1, name: "Connect Pubky Ring." });
    const parts = [
      heading,
      screen.getByText("Approve in Pubky Ring."),
      screen.getByRole("region", { name: "Hand-off" }),
      screen.getByRole("status"),
      screen.getByRole("button", { name: "Back" }),
    ];
    for (const [earlier, later] of parts
      .slice(0, -1)
      .map((part, index) => [part, parts[index + 1]!]))
      expect(
        earlier!.compareDocumentPosition(later!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    // The store badges belong to the hand-off's card (`RingHandoffCard`), not to the screen.
    expect(screen.queryByText("Don't have Pubky Ring?")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says what comes next without a spinner, and nothing where there is no status", () => {
    renderScreen(<RingHandoffStatus>Once you approve, the app signs you in.</RingHandoffStatus>);
    expect(screen.getByRole("status").querySelector('[data-slot="spinner"]')).toBeNull();
    cleanup();

    renderScreen();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
