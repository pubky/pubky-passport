/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
    expect(notification).toHaveClass("!border-brand");
    // A brand tint over an opaque base, so nothing behind the toast shows through.
    expect(notification).toHaveClass("bg-[#141419]", "from-brand/25", "to-brand/25");
    expect(notification).not.toHaveClass("bg-brand/25");
    // A dark tick in a filled brand circle, as pubky.app's success toasts show it.
    const icon = notification?.querySelector("[data-icon] svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("viewBox", "0 0 11.9967 8.66333");
    expect(notification?.querySelector("[data-icon]")?.firstElementChild).toHaveClass(
      "rounded-full",
      "bg-brand",
      "text-background",
    );
  });

  it("renders a failure as an error with a close button, in Passport's font", async () => {
    render(<Sonner />);

    act(() => {
      toast.error("Could not copy pubky", {
        closeButton: true,
        description: "Select and copy your pubky manually.",
      });
    });

    const title = await screen.findByText("Could not copy pubky");
    const notification = title.closest("[data-sonner-toast]");
    expect(notification).toHaveAttribute("data-type", "error");
    // Not the grey of a confirmation: the error colours the Notice primitive uses, from the
    // destructive tokens, over the same opaque base as the other tones.
    expect(notification).toHaveClass("!border-destructive-text/40", "bg-[#141419]");
    expect(notification).toHaveClass("from-destructive/15", "to-destructive/15");
    expect(notification?.className).not.toMatch(/rgba\(255,0,0/u);
    expect(notification).not.toHaveClass("!border-[#303034]");
    // Sonner's stylesheet sets a system font on the toaster; the toast sets Passport's own.
    expect(notification).toHaveClass("font-sans");
    expect(notification?.querySelector("[data-icon]")?.firstElementChild).toHaveClass(
      "text-destructive-text",
    );
    const close = screen.getByRole("button", { name: "Close toast" });
    expect(close).toHaveClass("order-last");
    act(() => close.click());
    await waitFor(() => expect(screen.queryByText("Could not copy pubky")).toBeNull());
  });

  it("keeps toasts below the header, so the logo and the sign-in band stay visible", async () => {
    render(<Sonner />);
    act(() => {
      toast.success("Backup verified");
    });

    const toaster = (await screen.findByText("Backup verified")).closest("[data-sonner-toaster]");
    expect(toaster?.getAttribute("style")).toContain(
      "--mobile-offset-top: calc(var(--passport-context-band-height) + var(--passport-header-height))",
    );
    expect(toaster?.getAttribute("style")).toContain(
      "--offset-top: calc(var(--passport-context-band-height) + 24px)",
    );
  });
});
