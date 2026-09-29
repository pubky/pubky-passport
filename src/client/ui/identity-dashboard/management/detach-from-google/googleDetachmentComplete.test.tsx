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
    expect(heading).toHaveTextContent("Detached from Google.");
    expect(heading.querySelector(".md\\:hidden")).toBeNull();
    expect(
      screen.getByText(
        /Your Google backup has been removed. You’re still signed in on this device./,
      ),
    ).toBeInTheDocument();
    // The shared success layout: checkmark, then one full-width Done at the bottom of a phone.
    expect(container.querySelector('img[src*="checkmark.png"]')).toHaveClass("size-40");
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toHaveClass("w-full");
    expect(done.parentElement).toHaveClass("mt-auto", "md:mt-0");
    await userEvent.setup().click(done);
    expect(onDone).toHaveBeenCalledOnce();
  });
});
