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
