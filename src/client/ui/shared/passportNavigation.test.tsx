/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./primitives/button";
import { PassportNavigation } from "./passportNavigation";

describe("PassportNavigation", () => {
  afterEach(cleanup);

  it("keeps a lone back action in the fixed left desktop column", () => {
    render(<PassportNavigation back={<Button>Back</Button>} />);

    const slot = screen.getByRole("button", { name: "Back" }).parentElement;
    expect(slot).toHaveClass("md:col-start-1");
    expect(slot?.parentElement).toHaveClass(
      "w-full",
      "md:grid-cols-(--passport-navigation-columns)",
    );
    expect(slot?.parentElement).not.toHaveClass("mt-auto");
  });

  it("keeps a lone confirm action in the fixed right desktop column", () => {
    render(<PassportNavigation confirm={<Button>Confirm</Button>} />);

    const slot = screen.getByRole("button", { name: "Confirm" }).parentElement;
    expect(slot).toHaveClass("md:col-start-3");
    expect(slot?.parentElement).toHaveClass(
      "w-full",
      "md:grid-cols-(--passport-navigation-columns)",
    );
  });

  it("gives paired actions equal full-width columns in reading order", () => {
    render(
      <PassportNavigation
        layout="paired"
        back={<Button>Cancel</Button>}
        confirm={<Button>Log out</Button>}
      />,
    );

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const logOut = screen.getByRole("button", { name: "Log out" });
    const grid = cancel.parentElement?.parentElement;
    expect(grid).toHaveClass("sm:grid-cols-2", "[&_button]:w-full");
    expect(grid).not.toHaveClass("md:grid-cols-(--passport-navigation-columns)");
    expect(cancel.parentElement).not.toHaveClass("md:col-start-1");
    expect(logOut.parentElement).not.toHaveClass("md:col-start-3");
    expect(cancel.compareDocumentPosition(logOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
