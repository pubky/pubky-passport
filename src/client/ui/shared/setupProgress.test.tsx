/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SetupProgress, SetupProgressProvider } from "./setupProgress";

describe("SetupProgress", () => {
  afterEach(cleanup);

  it("renders nothing outside a setup flow", () => {
    const { container } = render(<SetupProgress />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks completed, current and pending steps", () => {
    render(
      <SetupProgressProvider steps={["Account", "Keys", "Profile"]} current={1}>
        <SetupProgress />
      </SetupProgressProvider>,
    );

    const steps = within(
      screen.getByRole("navigation", { name: "Account setup progress" }),
    ).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    const [account, keys, profile] = steps;
    expect(account).toHaveTextContent("Completed: Account");
    expect(account).not.toHaveAttribute("aria-current");
    expect(keys).toHaveAttribute("aria-current", "step");
    expect(keys).toHaveTextContent("2Keys");
    expect(profile).toHaveTextContent("3Profile");
    expect(profile).not.toHaveAttribute("aria-current");
  });
});

describe("SetupProgress position", () => {
  afterEach(cleanup);

  it("keeps one width and position on compact and wide screens alike", () => {
    render(
      <SetupProgressProvider steps={["Account", "Keys", "Profile"]} current={0}>
        <SetupProgress />
      </SetupProgressProvider>,
    );

    expect(screen.getByRole("navigation", { name: "Account setup progress" })).toHaveClass(
      "mx-auto",
      "w-full",
      "min-[64.0625rem]:max-w-[588px]",
    );
  });

  it("starts and ends each line at its circles, whatever a label's length", () => {
    render(
      <SetupProgressProvider steps={["Google backup", "Profile"]} current={0}>
        <SetupProgress />
      </SetupProgressProvider>,
    );

    const first = screen.getByText("Google backup");
    const last = screen.getByText("Profile");
    // A label takes no width, so the column is only as wide as its circle.
    expect(first).toHaveClass("w-0", "whitespace-nowrap", "justify-start");
    expect(first.parentElement).toHaveClass("items-start");
    expect(last).toHaveClass("w-0", "justify-end");
    expect(last.parentElement).toHaveClass("items-end");
  });
});
