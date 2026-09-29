/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DRIVE_PERMISSION_HINT } from "@/client/ui/googleDrivePermissionPrompt";
import { ContinueWithGoogle, PASSPORT_README_URL } from "./continueWithGoogle";

const TITLE = "Continue with Google, powered by Pubky Passport.";
const HELP = "About signing in with Google";
/** How long the component lets the pointer rest on its way to the panel. */
const TRAVEL_REST_MS = 400;

/** Stubs matchMedia; the returned function flips the breakpoint and notifies subscribers. */
function stubViewport(desktop: boolean): (next: boolean) => void {
  const state = { matches: desktop };
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => ({
      get matches() {
        return state.matches;
      },
      media,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    })),
  );
  return (next) => {
    state.matches = next;
    act(() => {
      for (const listener of listeners) listener();
    });
  };
}

function renderControl(desktop: boolean) {
  const setDesktop = stubViewport(desktop);
  const onContinue = vi.fn();
  render(<ContinueWithGoogle onContinue={onContinue} />);
  return { onContinue, setDesktop, trigger: screen.getByRole("button", { name: HELP }) };
}

type Edges = { left: number; right: number; top: number; bottom: number };

/**
 * Lays the pill out at `pill` in a window of the given size; the panel card is 560px tall, and
 * the panel itself sits at `panel` when given.
 */
function placeControl(width: number, height: number, pill: Edges, panel?: Edges): void {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", height);
  const rect = ({ left, right, top, bottom }: Edges) =>
    ({
      left,
      right,
      top,
      bottom,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    }) as DOMRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.querySelector(`[aria-label="${HELP}"]`) && this.classList.contains("relative"))
      return rect(pill);
    if (this.getAttribute("role") === "dialog")
      return rect({ left: 0, right: 420, top: 0, bottom: 560 });
    if (panel && this.hasAttribute("data-placement")) return rect(panel);
    return rect({ left: 0, right: 0, top: 0, bottom: 0 });
  });
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
    vi.restoreAllMocks();
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

  it("tells the person to tick both Drive permissions before Google asks", () => {
    renderControl(true);

    const pill = screen.getByRole("button", { name: "Continue with Google" });
    expect(pill).toHaveAccessibleDescription(DRIVE_PERMISSION_HINT);
    // The hint sits under the control, outside the box the explainer panel is placed against.
    const hint = document.getElementById(pill.getAttribute("aria-describedby") ?? "");
    expect(hint).toHaveTextContent(DRIVE_PERMISSION_HINT);
    expect(pill.parentElement?.nextElementSibling).toBe(hint);
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
    it("pins the panel on click so it outlives the pointer, and unpins on the next click", () => {
      vi.useFakeTimers();
      const { onContinue, trigger } = renderControl(true);

      fireEvent.mouseEnter(trigger);
      fireEvent.click(trigger);
      fireEvent.mouseLeave(trigger);
      act(() => vi.advanceTimersByTime(500));

      const panel = screen.getByRole("dialog", { name: TITLE });
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(trigger).toHaveAttribute("aria-controls", panel.id);
      expect(panel.parentElement).toHaveClass("left-full", "top-0", "w-[432px]");
      expect(panel).toHaveAttribute("tabindex", "-1");
      expect(within(panel).getByRole("heading", { level: 2, name: TITLE })).toBeInTheDocument();
      expectExplanation(panel);
      expect(onContinue).not.toHaveBeenCalled();

      fireEvent.click(trigger);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("stays open when a press inside the panel moves focus onto it", () => {
      const { trigger } = renderControl(true);
      fireEvent.click(trigger);
      const panel = screen.getByRole("dialog");

      panel.focus();
      fireEvent.blur(trigger, { relatedTarget: panel });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("shows on hover, stays while the pointer is on the pill or the panel, and closes shortly after leaving", () => {
      vi.useFakeTimers();
      const { trigger } = renderControl(true);
      const pill = screen.getByRole("button", { name: "Continue with Google" });

      fireEvent.mouseOver(trigger);
      const panel = screen.getByRole("dialog");
      fireEvent.mouseOut(trigger, { relatedTarget: pill });
      fireEvent.mouseOver(pill, { relatedTarget: trigger });
      act(() => vi.advanceTimersByTime(500));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.mouseOut(pill, { relatedTarget: panel });
      fireEvent.mouseOver(panel, { relatedTarget: pill });
      act(() => vi.advanceTimersByTime(500));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.mouseOut(panel, { relatedTarget: document.body });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(150));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    describe("when the panel opens on the far side of the pill", () => {
      // A 1024px window: the pill ends near the right edge, so the panel opens to its left and
      // the mark sits about 370px from the panel.
      const PILL = { left: 556, right: 952, top: 492, bottom: 552 };
      const PANEL = { left: 124, right: 556, top: 492, bottom: 1052 };
      const LEARN_MORE = { x: 340, y: 1000 };

      /** Hovers the mark, then leaves the pill through its bottom edge just left of the mark. */
      function leaveTowardsPanel() {
        vi.useFakeTimers();
        placeControl(1024, 1200, PILL, PANEL);
        const { trigger } = renderControl(true);
        fireEvent.mouseOver(trigger);
        expect(screen.getByRole("dialog").parentElement).toHaveAttribute("data-placement", "left");
        const exit = { x: 910, y: 553 };
        fireEvent.mouseOut(trigger, {
          clientX: exit.x,
          clientY: exit.y,
          relatedTarget: document.body,
        });
        return exit;
      }

      /** A point `share` of the way along the straight line from `from` to Learn more. */
      function towardsLearnMore(from: { x: number; y: number }, share: number) {
        return {
          clientX: from.x + (LEARN_MORE.x - from.x) * share,
          clientY: from.y + (LEARN_MORE.y - from.y) * share,
        };
      }

      it("stays open while the pointer crosses outside the pill straight to the panel", () => {
        const exit = leaveTowardsPanel();

        for (const share of [0.1, 0.2, 0.3, 0.4, 0.5]) {
          fireEvent.mouseMove(document, towardsLearnMore(exit, share));
          act(() => vi.advanceTimersByTime(120));
        }
        expect(screen.getByRole("dialog")).toBeInTheDocument();

        // The browser sends the move that arrives right after the over event, before React
        // re-renders, so the travel listener still sees it.
        const learnMore = screen.getByRole("link", { name: "Learn more" });
        act(() => {
          learnMore.dispatchEvent(
            new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }),
          );
          learnMore.dispatchEvent(
            new MouseEvent("mousemove", { bubbles: true, ...towardsLearnMore(exit, 1) }),
          );
        });
        act(() => vi.advanceTimersByTime(1_000));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      it("closes when the pointer turns away from the panel", () => {
        const exit = leaveTowardsPanel();
        fireEvent.mouseMove(document, towardsLearnMore(exit, 0.1));

        fireEvent.mouseMove(document, { clientX: 1000, clientY: 700 });
        act(() => vi.advanceTimersByTime(TRAVEL_REST_MS));

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });

      it("closes when the pointer rests on its way to the panel", () => {
        const exit = leaveTowardsPanel();
        fireEvent.mouseMove(document, towardsLearnMore(exit, 0.2));

        act(() => vi.advanceTimersByTime(TRAVEL_REST_MS - 1));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        act(() => vi.advanceTimersByTime(1));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
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

    it("closes a hover-shown panel on Escape even though nothing in it has focus", () => {
      const { trigger } = renderControl(true);
      fireEvent.mouseEnter(trigger);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.keyDown(document.body, { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("leaves focus alone when Escape is pressed in a field elsewhere", () => {
      const { trigger } = renderControl(true);
      const field = document.body.appendChild(document.createElement("input"));
      fireEvent.mouseEnter(trigger);
      field.focus();

      fireEvent.keyDown(field, { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(field).toHaveFocus();
      field.remove();
    });

    it.each([
      ["right", 1440, 900, { left: 408, right: 660, top: 492, bottom: 552 }, "left-full"],
      ["left", 1024, 900, { left: 556, right: 952, top: 492, bottom: 552 }, "right-full"],
      ["below", 768, 900, { left: 64, right: 704, top: 300, bottom: 360 }, "top-full"],
      ["above", 768, 900, { left: 64, right: 704, top: 700, bottom: 760 }, "bottom-full"],
    ] as const)(
      "opens %s the pill when that keeps the panel inside a %ipx window",
      (placement, width, height, pill, positionClass) => {
        placeControl(width, height, pill);
        const { trigger } = renderControl(true);

        fireEvent.click(trigger);

        const wrapper = screen.getByRole("dialog", { name: TITLE }).parentElement!;
        expect(wrapper).toHaveAttribute("data-placement", placement);
        expect(wrapper).toHaveClass(positionClass);
        expect(wrapper.className).not.toMatch(/max-w-/u);
      },
    );

    it("moves the panel below the pill when the window narrows", () => {
      placeControl(1440, 900, { left: 408, right: 660, top: 300, bottom: 360 });
      const { trigger } = renderControl(true);
      fireEvent.click(trigger);
      const wrapper = () => screen.getByRole("dialog", { name: TITLE }).parentElement!;
      expect(wrapper()).toHaveAttribute("data-placement", "right");

      placeControl(768, 900, { left: 64, right: 704, top: 300, bottom: 360 });
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });

      expect(wrapper()).toHaveAttribute("data-placement", "below");
      expect(wrapper().style.top).toBe("");
    });

    it("drops a pinned panel when the viewport shrinks to a phone", () => {
      const { setDesktop, trigger } = renderControl(true);
      fireEvent.click(trigger);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      setDesktop(false);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(trigger);
      expect(screen.getByRole("dialog").tagName).toBe("DIALOG");
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
      expect(sheet).toHaveClass("mt-auto", "rounded-t-2xl", "p-0");
      expect(within(sheet).getByRole("heading", { level: 2, name: TITLE })).toBeInTheDocument();
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expectExplanation(sheet);
      expect(within(sheet).getByRole("button", { name: "Close" })).toBeInTheDocument();

      const signIn = within(sheet).getByRole("button", { name: "Continue with Google" });
      expect(signIn).toHaveAccessibleDescription(DRIVE_PERMISSION_HINT);
      fireEvent.click(signIn);

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
      fireEvent.click(within(sheet).getByRole("button", { name: "Close" }).parentElement!);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.click(sheet);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
