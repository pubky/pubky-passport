/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleDetachmentComplete } from "./googleDetachmentComplete";

describe("GoogleDetachmentComplete", () => {
  afterEach(cleanup);

  it("matches the detached completion state and finishes the flow", async () => {
    const onDone = vi.fn();
    render(<GoogleDetachmentComplete onDone={onDone} />);

    expect(screen.getByRole("heading", { name: "Detached from Google." })).toBeInTheDocument();
    expect(screen.getByText("Google access has been removed. Your identity is self-managed and recoverable only through your chosen recovery method.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledOnce();
  });
});
