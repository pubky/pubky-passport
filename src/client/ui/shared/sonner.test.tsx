/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it } from "vitest";

import { showCopyConfirmation, Sonner } from "./sonner";

describe("Sonner", () => {
  afterEach(() => {
    act(() => { toast.dismiss(); });
    cleanup();
  });

  it("renders the designed copy confirmation", async () => {
    render(<Sonner />);

    act(() => { showCopyConfirmation("Pubky"); });

    const message = await screen.findByText("Pubky copied");
    const notification = message.closest("[data-sonner-toast]");
    expect(notification).toHaveClass("border-brand/50", "bg-brand/25", "p-6", "backdrop-blur-[10px]");
    expect(notification).toHaveAttribute("data-type", "info");
    expect(notification?.querySelector("img")).toHaveAttribute("src", "/icons/sonner-info.svg");
    expect(notification?.querySelector("img")).toHaveAttribute("width", "20");
    expect(notification?.querySelector("img")).toHaveAttribute("height", "20");
  });
});
