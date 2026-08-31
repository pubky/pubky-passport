/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it } from "vitest";

import { Sonner } from "./sonner";

describe("Sonner", () => {
  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
    cleanup();
  });

  it("renders a gray info notification with its icon and description", async () => {
    render(<Sonner />);

    act(() => {
      toast.info("Copied", { description: "Copied value" });
    });

    const title = await screen.findByText("Copied");
    const notification = title.closest("[data-sonner-toast]");
    expect(notification).toHaveAttribute("data-type", "info");
    expect(notification).toHaveClass("!border-[#303034]");
    const icon = notification?.querySelector("[data-icon] svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("viewBox", "0 0 20 20");
    expect(icon?.parentElement).toHaveClass("text-[#89898F]");
    expect(screen.getByText("Copied value")).toBeInTheDocument();
  });

  it("renders a green success notification with its checkmark", async () => {
    render(<Sonner />);

    act(() => {
      toast.success("Saved");
    });

    const title = await screen.findByText("Saved");
    const notification = title.closest("[data-sonner-toast]");
    expect(notification).toHaveAttribute("data-type", "success");
    expect(notification).toHaveClass("!border-brand/50", "bg-brand/25");
    const icon = notification?.querySelector("[data-icon] svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("viewBox", "0 0 20 20");
    expect(icon?.parentElement).toHaveClass("text-brand");
  });
});
