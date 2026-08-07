/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewGoogleDetachment } from "./reviewGoogleDetachment";

describe("ReviewGoogleDetachment", () => {
  afterEach(cleanup);

  it("shows the Figma warning and gates the DELETE dialog behind Remove Google Access", async () => {
    const onBack = vi.fn();
    const onRemove = vi.fn();
    render(<ReviewGoogleDetachment onBack={onBack} onRemove={onRemove} />);

    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
    expect(screen.getByText(/This can’t be undone/)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="google-detachment-illustration"]'))
      .toHaveAttribute("src", "/illustrations/detach-from-google.png");

    await userEvent.setup().click(screen.getByRole("button", { name: "Remove Google Access" }));
    expect(onRemove).toHaveBeenCalledOnce();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
