/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it } from "vitest";

import { showCopyConfirmation, showDownloadConfirmation, Sonner } from "./sonner";

describe("Sonner", () => {
  afterEach(() => {
    act(() => { toast.dismiss(); });
    cleanup();
  });

  it("renders the designed copy confirmation", async () => {
    render(<Sonner />);

    act(() => { showCopyConfirmation("Pubky"); });

    const message = await screen.findByText("Pubky copied");
    expect(document.querySelector("[data-sonner-toaster]")).toHaveStyle("--width: 392px");
    const notification = message.closest("[data-sonner-toast]");
    expect(notification).toHaveClass(
      "border",
      "border-solid",
      "!border-[#303034]",
      "bg-[linear-gradient(rgba(5,5,10,0.6),rgba(5,5,10,0.6)),linear-gradient(#454549,#454549)]",
      "p-6",
      "backdrop-blur-[10px]",
    );
    expect(notification).toHaveAttribute("data-type", "info");
    expect(notification?.querySelector("img")).toHaveAttribute("src", "/icons/sonner-info.svg");
    expect(notification?.querySelector("img")).toHaveAttribute("width", "20");
    expect(notification?.querySelector("img")).toHaveAttribute("height", "20");
  });

  it("renders a recovery-file download confirmation", async () => {
    render(<Sonner />);

    act(() => { showDownloadConfirmation(); });

    const message = await screen.findByText("File downloaded");
    const notification = message.closest("[data-sonner-toast]");
    expect(notification).toHaveAttribute("data-type", "success");
    expect(notification).toHaveClass("!border-brand/50", "bg-brand/25");
    expect(notification?.querySelector("img")).toHaveAttribute("src", "/icons/sonner-success.svg");
    expect(notification?.querySelector("img")).toHaveAttribute("width", "20");
    expect(notification?.querySelector("img")).toHaveAttribute("height", "20");
  });
});
