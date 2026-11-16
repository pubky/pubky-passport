/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DetachmentComplete } from "./detachmentComplete";

describe("DetachmentComplete", () => {
  afterEach(cleanup);

  it("matches the detached completion state and finishes the flow", async () => {
    const onDone = vi.fn();
    const { container } = render(<DetachmentComplete onDone={onDone} providerName="Google" />);

    const heading = screen.getByRole("heading", { name: "Detached from Google." });
    expect(heading).toHaveTextContent("Detached from Google.");
    expect(heading.querySelector(".md\\:hidden")).toBeNull();
    expect(
      screen.getByText(
        "Google access has been removed. Your pubky is self-managed and recoverable only with your backup.",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector('img[src*="checkmark.png"]')?.parentElement).toHaveClass(
      "h-[296px]",
    );
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toHaveClass("mt-auto");
    await userEvent.setup().click(done);
    expect(onDone).toHaveBeenCalledOnce();
  });
});
