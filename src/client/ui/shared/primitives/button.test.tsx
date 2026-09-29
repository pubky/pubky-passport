/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { ArrowRightIcon } from "@/client/ui/shared/icons";

import { Button, ButtonLink, LARGE_PADDING_X } from "./button";

describe("Button", () => {
  afterEach(cleanup);

  it("renders a native button and forwards its ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button disabled ref={ref}>
        Continue
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("type", "button");
    expect(ref.current).toBe(button);
  });

  it("shows a loading button as busy, not disabled, with a spinner in place of its icon", () => {
    render(
      <Button disabled loading>
        <ArrowRightIcon />
        Importing…
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Importing…" });
    // Natively disabling the pressed button would drop keyboard focus to the page.
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveClass("opacity-100!", "[&>[data-slot=icon]]:hidden");
    const spinner = button.querySelector('[data-slot="spinner"]');
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    expect(spinner).not.toHaveAttribute("role");
    expect(spinner).toHaveClass("motion-reduce:animate-none");
  });

  it.each([
    ["Pubky", <PubkyBrandIcon key="pubky" />],
    ["Google", <GoogleLogo key="google" />],
  ])("hides the %s brand mark behind the spinner like any leading icon", (_brand, mark) => {
    render(
      <Button loading>
        {mark}
        Authorizing…
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Authorizing…" });
    // `[&>[data-slot=icon]]:hidden` hides direct children marked as the icon while loading.
    expect(button.querySelector(':scope > [data-slot="icon"]')).not.toBeNull();
  });

  it("keeps focus on a loading button and ignores presses, including form submission", async () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const { rerender } = render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <Button onClick={onClick} type="submit">
          Import
        </Button>
      </form>,
    );
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Import" });
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();

    rerender(
      <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <Button loading onClick={onClick} type="submit">
          Importing…
        </Button>
      </form>,
    );
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(button).toHaveFocus();
  });

  it("wraps a label that does not fit below md, and gives touch pointers 44px targets", () => {
    render(
      <>
        <Button size="lg">Download encrypted backup</Button>
        <Button>Download backup</Button>
        <Button size="sm">Set up profile</Button>
        <Button aria-label="Close" className="size-8" size="icon" />
      </>,
    );

    const lg = screen.getByRole("button", { name: "Download encrypted backup" });
    // A minimum height for one line, so a wrapped label grows the pill instead of spilling out.
    expect(lg).toHaveClass("min-h-15", "md:whitespace-nowrap", "text-center");
    expect(lg).not.toHaveClass("h-15", "whitespace-nowrap");
    expect(screen.getByRole("button", { name: "Download backup" })).toHaveClass(
      "min-h-10",
      "pointer-coarse:min-h-11",
    );
    expect(screen.getByRole("button", { name: "Set up profile" })).toHaveClass(
      "min-h-8",
      "pointer-coarse:min-h-11",
    );
    // A smaller icon button still grows to 44px under a finger.
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass(
      "size-8",
      "pointer-coarse:size-11",
    );
  });

  it("narrows the large pill's padding in a narrow window, unless the caller sets its own", () => {
    render(
      <>
        <Button size="lg">Create account</Button>
        <Button className="px-3" size="lg">
          Resend Code
        </Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Create account" })).toHaveClass(LARGE_PADDING_X);
    const own = screen.getByRole("button", { name: "Resend Code" });
    expect(own).toHaveClass("px-3");
    expect(own).not.toHaveClass(LARGE_PADDING_X);
    expect(own.className).not.toMatch(/(^|\s)\S+:px-/u);
  });

  it.each([
    ["link", "text-secondary-foreground"],
    ["linkDestructive", "text-destructive-text"],
  ] as const)(
    "draws a %s text action on the column edge, whatever size it is given",
    (variant, colour) => {
      render(
        <Button size="lg" variant={variant}>
          Skip
        </Button>,
      );

      const button = screen.getByRole("button", { name: "Skip" });
      // No padding, border or pill: the text lines up with the labels and text around it.
      expect(button).toHaveClass("px-0", "border-0", "underline", "text-sm", colour);
      expect(button).not.toHaveClass(LARGE_PADDING_X, "min-h-15", "rounded-full");
      // A long text action wraps at every width, like the text around it.
      expect(button).toHaveClass("whitespace-normal", "md:whitespace-normal");
      // Touch screens still get a 44px target.
      expect(button).toHaveClass("pointer-coarse:min-h-11");
    },
  );

  it("renders an anchor and forwards its anchor ref", () => {
    const ref = createRef<HTMLAnchorElement>();
    render(
      <ButtonLink href="/authorize" ref={ref}>
        Authorize
      </ButtonLink>,
    );

    const link = screen.getByRole("link", { name: "Authorize" });
    expect(link).toHaveAttribute("href", "/authorize");
    expect(ref.current).toBe(link);
  });
});
