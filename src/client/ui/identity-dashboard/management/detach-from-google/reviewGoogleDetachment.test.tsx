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
    render(<ReviewGoogleDetachment onBack={onBack} onRemove={onRemove} />);

    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
    expect(screen.getByText(/This can’t be undone/)).toBeInTheDocument();
    const illustrationLayers = document.querySelectorAll('[data-slot="google-detachment-illustration"] img');
    expect(illustrationLayers[0]).toHaveAttribute("src", "/illustrations/cloud.png");
    expect(illustrationLayers[1]).toHaveAttribute("src", "/illustrations/red-line.svg");

    await userEvent.setup().click(screen.getByRole("button", { name: "Remove Google Access" }));
    expect(onRemove).toHaveBeenCalledOnce();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
