/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AcknowledgementCheckbox } from "./acknowledgementCheckbox";

afterEach(cleanup);

describe("AcknowledgementCheckbox", () => {
  it("is a checkbox named by its statement that reports each change", async () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <AcknowledgementCheckbox checked={false} onCheckedChange={onCheckedChange}>
        I still have the recovery file.
      </AcknowledgementCheckbox>,
    );
    const checkbox = screen.getByRole("checkbox", { name: "I still have the recovery file." });

    await userEvent.setup().click(checkbox);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <AcknowledgementCheckbox checked onCheckedChange={onCheckedChange}>
        I still have the recovery file.
      </AcknowledgementCheckbox>,
    );
    expect(checkbox).toBeChecked();
    await userEvent.setup().click(checkbox);
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });
});
