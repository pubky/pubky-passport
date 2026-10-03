/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PassportHeaderAction } from "./passportHeaderAction";

describe("PassportHeaderAction", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("passport-header-actions")?.remove();
  });

  it("places the action in the shared page header", () => {
    const slot = document.createElement("div");
    slot.id = "passport-header-actions";
    document.body.append(slot);

    const { container, unmount } = render(
      <main>
        <PassportHeaderAction>
          <button type="button">Log out</button>
        </PassportHeaderAction>
      </main>,
    );

    expect(slot).toContainElement(screen.getByRole("button", { name: "Log out" }));
    expect(container).not.toContainElement(screen.getByRole("button", { name: "Log out" }));
    unmount();
    expect(slot).toBeEmptyDOMElement();
  });

  it("renders the action in place when the page has no header slot", () => {
    render(
      <main>
        <PassportHeaderAction>
          <button type="button">Log out</button>
        </PassportHeaderAction>
      </main>,
    );

    expect(screen.getByRole("main")).toContainElement(
      screen.getByRole("button", { name: "Log out" }),
    );
  });
});
