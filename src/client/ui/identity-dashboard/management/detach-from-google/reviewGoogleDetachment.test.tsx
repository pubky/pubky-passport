/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewGoogleDetachment } from "./reviewGoogleDetachment";

describe("ReviewGoogleDetachment", () => {
  afterEach(cleanup);

  it("shows the warning and gates confirmation behind Remove Google Access", async () => {
    const onBack = vi.fn();
    const onRemove = vi.fn();
    const { container } = render(<ReviewGoogleDetachment onBack={onBack} onRemove={onRemove} />);

    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
    expect(
      screen.getByText("You are about to remove Google as a way to access your pubky identity."),
    ).toBeInTheDocument();
    expect(screen.getByText(/This can’t be undone/)).toBeInTheDocument();
    const redLine = container.querySelector('img[src$="red-line.svg"]');
    expect(redLine).toHaveClass("h-auto");
    expect(redLine).toHaveAttribute("width", "282");

    await userEvent.setup().click(screen.getByRole("button", { name: "Remove Google Access" }));
    expect(onRemove).toHaveBeenCalledOnce();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
