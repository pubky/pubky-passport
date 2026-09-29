/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ErrorScreen } from "./errorScreen";
import { Button } from "./primitives/button";

describe("ErrorScreen", () => {
  afterEach(cleanup);

  it("focuses the heading, described by the cause and next step, so all are announced", () => {
    render(
      <>
        <button type="button">Somewhere else</button>
        <ErrorScreen
          accent="interrupted."
          cause="Passport could not reach this invite's homeserver."
          nextStep="Retry once it answers."
          title="Setup"
        />
      </>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Setup interrupted." });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAccessibleDescription(
      "Passport could not reach this invite's homeserver. Retry once it answers.",
    );
    // The accent keeps Passport's brand colour, as on every other heading.
    expect(within(heading).getByText("interrupted.")).toHaveClass("text-brand");
    expect(screen.getByText("Retry once it answers.")).toBeVisible();
  });

  it("uses the given accessible name when the visible heading changes by viewport", () => {
    render(
      <ErrorScreen
        accent="denied."
        cause="Passport needs Google Drive access."
        label="Google Drive access denied."
        title={
          <>
            Google <span className="hidden md:inline">Drive</span> access
          </>
        }
      />,
    );

    const heading = screen.getByRole("heading", { name: "Google Drive access denied." });
    expect(heading).toHaveFocus();
    // Without a next step the description is the cause alone.
    expect(heading).toHaveAccessibleDescription("Passport needs Google Drive access.");
  });

  it("orders context, back, the recovery action, a further option, help, then collapsed details", () => {
    render(
      <ErrorScreen
        accent="interrupted."
        action={<Button>Try again</Button>}
        back={<Button>Back</Button>}
        cause="Passport found your identity file, but it is damaged."
        details={{ code: "invalid_passport_file", detail: "parse_failed" }}
        help={<Button variant="outline">Play animation</Button>}
        secondaryAction={<Button variant="ghost">Delete backup &amp; create new pubky</Button>}
        title="Setup"
      >
        <p>Context the person needs to decide.</p>
      </ErrorScreen>,
    );

    // Help follows every action, so focus reaches the actions first.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Back",
      "Try again",
      "Delete backup & create new pubky",
      "Play animation",
    ]);
    const context = screen.getByText("Context the person needs to decide.");
    const back = screen.getByRole("button", { name: "Back" });
    expect(context.compareDocumentPosition(back)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const summary = screen.getByText("Technical details");
    expect(summary.tagName).toBe("SUMMARY");
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("Error code: invalid_passport_file · parse_failed");
    expect(back.compareDocumentPosition(details)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByRole("button", { name: "Play animation" }).compareDocumentPosition(details),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("puts a further option in the side row under the actions, on the column's edge", () => {
    const { rerender } = render(
      <ErrorScreen
        accent="interrupted."
        back={<Button>Back</Button>}
        cause="The file is damaged."
        secondaryAction={<Button variant="linkDestructive">Delete backup</Button>}
        title="Setup"
      />,
    );
    const option = () => screen.getByRole("button", { name: "Delete backup" });
    const row = () => option().closest('[data-slot="tertiary-actions"]');
    expect(row()).not.toBeNull();
    expect(row()).not.toHaveClass("justify-center");
    // One order whatever the actions: Back first, then the recovery action, then side options.
    expect(
      screen.getByRole("button", { name: "Back" }).compareDocumentPosition(option()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    rerender(
      <ErrorScreen
        accent="interrupted."
        action={<Button>Try again</Button>}
        back={<Button>Back</Button>}
        cause="The file is damaged."
        secondaryAction={<Button variant="linkDestructive">Delete backup</Button>}
        title="Setup"
      />,
    );
    expect(row()).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Try again" }).compareDocumentPosition(option()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders no action row or details when there are none", () => {
    render(<ErrorScreen accent="failed." cause="Something failed." title="Setup" />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Technical details")).toBeNull();
  });
});
