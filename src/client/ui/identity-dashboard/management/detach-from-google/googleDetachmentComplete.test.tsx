/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleDetachmentComplete } from "./googleDetachmentComplete";

describe("GoogleDetachmentComplete", () => {
  afterEach(cleanup);

  it("matches the detached completion state and finishes the flow", async () => {
    const onDone = vi.fn();
    const { container } = render(<GoogleDetachmentComplete onDone={onDone} />);

    const heading = screen.getByRole("heading", { name: "Detached from Google." });
    expect(heading).toBeInTheDocument();
    expect(heading.querySelector(".md\\:hidden")).toHaveTextContent("Detached");
    expect(heading.querySelector(".hidden.md\\:inline")).toHaveTextContent("Detach");
    expect(
      screen.getByText(
        "Google access has been removed. Your identity is self-managed, and recoverable only with your backup.",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector('img[src*="checkmark.png"]')?.parentElement).toHaveClass(
      "h-[296px]",
      "md:h-56",
    );
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toHaveClass("mt-auto", "md:mt-0");
    await userEvent.setup().click(done);
    expect(onDone).toHaveBeenCalledOnce();
  });
});
