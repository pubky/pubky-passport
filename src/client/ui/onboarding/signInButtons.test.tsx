/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContinueWithApple } from "./apple/continueWithApple";
import { ContinueWithGoogle } from "./google/continueWithGoogle";
import { ProviderChoice } from "./providerChoice";
import { SIGN_IN_BUTTON_HEIGHT } from "./signInButtonSize";

afterEach(cleanup);

describe("sign-in buttons", () => {
  it("are the same height and full width", () => {
    render(
      <ProviderChoice
        apple={{ ready: true, onContinue: vi.fn() }}
        onContinueWithGoogle={vi.fn()}
      />,
    );

    const apple = screen.getByRole("button", { name: "Continue with Apple" });
    const google = screen.getByRole("button", { name: "Continue with Google" });
    for (const button of [apple, google]) {
      expect(button.style.height).toBe("60px");
      expect(button).toHaveClass("w-full", "rounded-full");
    }
  });

  it("draws Continue with Apple in Apple's white style with the title at 43% of the height", () => {
    render(<ContinueWithApple onContinue={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Continue with Apple" });
    expect(button).toHaveClass("bg-white", "text-black", "pl-[8%]");
    expect(button.className).not.toMatch(/hover:/u);
    expect(button.style.fontFamily).toMatch(/^-apple-system, BlinkMacSystemFont, "SF Pro Text"/u);
    expect(button.style.fontSize).toBe(`${SIGN_IN_BUTTON_HEIGHT * 0.43}px`);
    expect(button.style.fontWeight).toBe("500");
    expect(button.style.letterSpacing).toBe("-0.022em");
    expect(button.className).not.toMatch(/opacity/u);
    expect(button.textContent).toBe("Continue with Apple");
    expect(button.querySelector("img")).toHaveAttribute(
      "src",
      "/brand/sign-in-with-apple/logo-left-aligned-black-small.svg",
    );
  });

  it("draws Continue with Google in Google's Light theme, scaled from Google's 40px button", () => {
    render(<ContinueWithGoogle onContinue={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Continue with Google" });
    expect(button).toHaveClass("bg-white", "border", "border-[#747775]", "text-[#1F1F1F]");
    const scale = SIGN_IN_BUTTON_HEIGHT / 40;
    expect(button.style.fontFamily).toBe('"Google Sans", Roboto, Arial, sans-serif');
    expect(button.style.fontSize).toBe(`${14 * scale}px`);
    expect(button.style.fontWeight).toBe("500");
    expect(button.style.letterSpacing).toBe(`${0.25 * scale}px`);
    expect(button.style.paddingLeft).toBe(`${12 * scale}px`);
    expect(button.textContent).toBe("Continue with Google");
    const logo = button.querySelector("img");
    expect(logo?.style.height).toBe(`${20 * scale}px`);
    expect(logo?.style.width).toBe(`${20 * scale}px`);
    expect(logo?.style.marginRight).toBe(`${10 * scale}px`);
  });

  it("call their handlers, and Apple waits until Apple's script is ready", async () => {
    const onApple = vi.fn();
    const onGoogle = vi.fn();
    const { rerender } = render(
      <ProviderChoice
        apple={{ ready: false, onContinue: onApple }}
        onContinueWithGoogle={onGoogle}
      />,
    );

    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(onGoogle).toHaveBeenCalledOnce();

    rerender(
      <ProviderChoice
        apple={{ ready: true, onContinue: onApple }}
        onContinueWithGoogle={onGoogle}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(onApple).toHaveBeenCalledOnce();
  });
});

it.each(["Apple", "Google"] as const)(
  "opens %s help without starting sign-in",
  async (provider) => {
    const signIn = vi.fn();
    render(
      provider === "Apple" ? (
        <ContinueWithApple onContinue={signIn} />
      ) : (
        <ContinueWithGoogle onContinue={signIn} />
      ),
    );
    const help = screen.getByRole("button", { name: `How ${provider} sign-in works` });
    expect(help.closest("button")?.parentElement?.closest("button")).toBeNull();
    await userEvent.click(help);
    const dialog = screen.getByRole("dialog", { name: `How ${provider} sign-in works` });
    expect(dialog).toBeVisible();
    expect(signIn).not.toHaveBeenCalled();
    if (provider === "Apple") expect(dialog).toHaveTextContent("Step 2 of 2");
    else expect(dialog).toHaveTextContent("encrypted file is kept in your Google Drive");
  },
);
