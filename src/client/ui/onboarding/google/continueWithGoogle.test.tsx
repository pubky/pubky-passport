/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContinueWithGoogle, PASSPORT_README_URL } from "./continueWithGoogle";

const TITLE = "Continue with Google, powered by Pubky Passport.";
const HELP = "How Continue with Google works";

function stubViewport(desktop: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => ({
      matches: desktop,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderControl(desktop: boolean) {
  stubViewport(desktop);
  const onContinue = vi.fn();
  render(<ContinueWithGoogle onContinue={onContinue} />);
  return { onContinue, trigger: screen.getByRole("button", { name: HELP }) };
}

function expectExplanation(container: HTMLElement): void {
  expect(container).toHaveTextContent(
    "Google's role: Helps identify you and securely retrieve your encrypted backup. It does not create or control your pubky.",
  );
  expect(container).toHaveTextContent(
    "Your keys: Keys are created in your browser and encrypted before storage on Google Drive. Google never sees the private key.",
  );
  expect(container).toHaveTextContent(
    "Recovery: Recovery requires both your encrypted Google Drive backup and a separate recovery key from Passport.",
  );
  expect(container).toHaveTextContent(
    "Split security: Neither Google nor Passport can recover your pubky on its own, reducing reliance on either one.",
  );
  const learnMore = within(container).getByRole("link", { name: "Learn more" });
  expect(learnMore).toHaveAttribute("href", PASSPORT_README_URL);
  expect(learnMore).toHaveAttribute("target", "_blank");
  expect(learnMore).toHaveAttribute("rel", "noopener noreferrer");
}

describe("ContinueWithGoogle", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("signs in from the pill, which keeps its accessible name with the help mark inside", () => {
    const { onContinue, trigger } = renderControl(true);

    const pill = screen.getByRole("button", { name: "Continue with Google" });
    fireEvent.click(pill);

    expect(onContinue).toHaveBeenCalledOnce();
    expect(pill).toHaveClass("w-full");
    expect(pill.parentElement).toHaveClass("relative", "flex");
    expect(pill.textContent).toBe("");
    expect(trigger.parentElement).toHaveClass("pointer-events-none");
    expect(trigger).toHaveClass("pointer-events-auto");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("renders on the server as a closed control", () => {
    const markup = renderToStaticMarkup(<ContinueWithGoogle onContinue={() => undefined} />);
    const shell = document.body.appendChild(document.createElement("div"));
    shell.innerHTML = markup;

    expect(within(shell).getByRole("button", { name: "Continue with Google" })).toBeEnabled();
    expect(within(shell).getByRole("button", { name: HELP })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(shell.querySelector("dialog")).not.toHaveAttribute("open");
    expect(shell.querySelector("[role='dialog']")).toBeNull();
    shell.remove();
  });

  describe("on desktop", () => {
    it("pins the panel on click, explains the split, and unpins on the next click", () => {
      const { onContinue, trigger } = renderControl(true);

      fireEvent.click(trigger);

      const panel = screen.getByRole("dialog", { name: TITLE });
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(trigger).toHaveAttribute("aria-controls", panel.id);
      expect(panel.parentElement).toHaveClass("left-full", "top-0", "w-[432px]");
      expectExplanation(panel);
      expect(onContinue).not.toHaveBeenCalled();

      fireEvent.click(trigger);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("shows on hover, survives the move into the panel, and closes shortly after leaving", () => {
      vi.useFakeTimers();
      const { trigger } = renderControl(true);

      fireEvent.mouseEnter(trigger);
      const panel = screen.getByRole("dialog");
      fireEvent.mouseLeave(trigger);
      fireEvent.mouseEnter(panel.parentElement as HTMLElement);
      act(() => vi.advanceTimersByTime(500));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.mouseLeave(panel.parentElement as HTMLElement);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(150));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows on focus and closes when focus leaves the control", () => {
      const { trigger } = renderControl(true);

      fireEvent.focus(trigger);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.blur(screen.getByRole("link", { name: "Learn more" }), {
        relatedTarget: document.body,
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("closes on Escape and returns focus to the help mark without reopening", () => {
      const { trigger } = renderControl(true);
      fireEvent.click(trigger);

      fireEvent.keyDown(screen.getByRole("link", { name: "Learn more" }), { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it("closes a pinned panel when pressing outside the control", () => {
      const { trigger } = renderControl(true);
      fireEvent.click(trigger);

      fireEvent.pointerDown(screen.getByRole("link", { name: "Learn more" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("on a phone", () => {
    it("opens a bottom sheet that explains the split and can sign in", () => {
      const { onContinue, trigger } = renderControl(false);

      fireEvent.mouseEnter(trigger);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      fireEvent.click(trigger);

      const sheet = screen.getByRole("dialog", { name: TITLE });
      expect(sheet.tagName).toBe("DIALOG");
      expect(sheet).toHaveClass("mt-auto", "rounded-t-2xl");
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expectExplanation(sheet);
      expect(within(sheet).getByRole("button", { name: "Close" })).toBeInTheDocument();

      fireEvent.click(within(sheet).getByRole("button", { name: "Continue with Google" }));

      expect(onContinue).toHaveBeenCalledOnce();
      expect(sheet).not.toHaveAttribute("open");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("closes the sheet from its handle and from the backdrop", () => {
      const { trigger } = renderControl(false);

      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      fireEvent.click(trigger);
      const sheet = screen.getByRole("dialog");
      fireEvent.click(within(sheet).getByRole("link", { name: "Learn more" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.click(sheet);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
