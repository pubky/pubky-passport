/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectICloudScreen } from "./apple/connectICloudScreen";
import { ContinueWithApple } from "./apple/continueWithApple";
import { ContinueWithGoogle } from "./google/continueWithGoogle";
import { ProviderChoice } from "./providerChoice";

afterEach(cleanup);

describe("sign-in buttons", () => {
  it("uses matching compact Figma pills, exact assets, and independent help controls", () => {
    render(
      <ProviderChoice
        apple={{ ready: true, onContinue: vi.fn() }}
        onContinueWithGoogle={vi.fn()}
      />,
    );
    for (const provider of ["Apple", "Google"]) {
      const button = screen.getByRole("button", { name: `Continue with ${provider}` });
      expect(button).toHaveClass("h-15", "w-full", "rounded-full", "text-sm", "font-bold");
      expect(button).toHaveClass("leading-5", "bg-white", "text-[#1d1d20]");
      expect(button).not.toHaveAttribute("style");
      const logo = button.querySelector("img");
      expect(logo).toHaveAttribute(
        "src",
        provider === "Apple" ? "/brand/apple-logo.svg" : "/brand/google-sign-in-g.png",
      );
      expect(logo).toHaveClass("size-4");
      const help = screen.getByRole("button", { name: `How ${provider} sign-in works` });
      expect(button).not.toContainElement(help);
      expect(help.closest("button")?.parentElement?.closest("button")).toBeNull();
      expect(help.querySelector("img")).toHaveAttribute("src", "/icons/circle-help.svg");
    }
  });

  it("calls the original provider handlers and keeps Apple disabled until ready", async () => {
    const onApple = vi.fn();
    const onGoogle = vi.fn();
    const { rerender } = render(
      <ProviderChoice
        apple={{ ready: false, onContinue: onApple }}
        onContinueWithGoogle={onGoogle}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(onApple).not.toHaveBeenCalled();
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

  it.each(["Apple", "Google"] as const)(
    "%s help stays separate, has four labelled paragraphs/two actions, and continues synchronously",
    async (provider) => {
      const signIn = vi.fn(() => expect(dialog.open).toBe(false));
      render(
        provider === "Apple" ? (
          <ContinueWithApple onContinue={signIn} />
        ) : (
          <ContinueWithGoogle onContinue={signIn} />
        ),
      );
      const help = screen.getByRole("button", { name: `How ${provider} sign-in works` });
      await userEvent.click(help);
      const dialog: HTMLDialogElement = screen.getByRole("dialog", {
        name: `Continue with ${provider}, powered by Pubky Passport.`,
      });
      expect(signIn).not.toHaveBeenCalled();
      expect(dialog.querySelectorAll("p")).toHaveLength(4);
      expect(dialog.querySelectorAll("p > strong")).toHaveLength(4);
      expect([...dialog.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
        "Your provider: Your account provider helps you sign in and find your encrypted backup. It does not create or control your pubky.",
        "Your keys: Your keys are created in your browser and encrypted before they are saved in your cloud storage.",
        "Recovery: When you sign in, Passport retrieves your encrypted backup and the separate key needed to unlock it.",
        "Split security: Your encrypted backup and the key that unlocks it are stored separately.",
      ]);
      expect(dialog).not.toHaveTextContent(
        /recovery phrase|recovery key from Passport|never sees/u,
      );
      const action = within(dialog).getByRole("button", { name: `Continue with ${provider}` });
      expect(within(dialog).getByRole("button", { name: "Learn more" })).toBeVisible();
      fireEvent.click(action);
      // Assert before yielding: popup auth must stay in the original trusted click.
      expect(signIn).toHaveBeenCalledOnce();
      expect(dialog.open).toBe(false);
    },
  );

  it.each(["Apple", "Google"] as const)(
    "keeps %s help readable while its auth actions are disabled",
    async (provider) => {
      const signIn = vi.fn();
      const control = (disabled: boolean) =>
        provider === "Apple" ? (
          <ContinueWithApple disabled={disabled} onContinue={signIn} />
        ) : (
          <ContinueWithGoogle disabled={disabled} onContinue={signIn} />
        );
      const { rerender } = render(control(false));
      const help = screen.getByRole("button", { name: `How ${provider} sign-in works` });
      await userEvent.click(help);
      rerender(control(true));
      const dialog = screen.getByRole("dialog");
      const action = within(dialog).getByRole("button", { name: `Continue with ${provider}` });
      expect(action).toBeDisabled();
      await userEvent.click(action);
      expect(signIn).not.toHaveBeenCalled();
      expect(dialog).toBeVisible();
      await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      expect(help).toHaveFocus();
      expect(help).toBeEnabled();
      expect(screen.getByRole("button", { name: `Continue with ${provider}` })).toBeDisabled();
    },
  );

  it("preserves the detach-specific explanation and exact iCloud connection callback", async () => {
    const onConnect = vi.fn();
    render(
      <ConnectICloudScreen
        onBack={vi.fn()}
        onConnect={onConnect}
        pending={false}
        purpose="detach"
        ready
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "How Apple sign-in works" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Continue with Apple, powered by Pubky Passport.");
    expect([...dialog.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "Apple’s role: Sign in with the Apple Account that holds your encrypted backup.",
      "Your keys: Allow Passport to delete its encrypted key backup from your iCloud.",
      "Recovery: Keep a recovery file before detaching. Passport removes the iCloud backup and this browser’s copy.",
      "After detaching: Apple sign-in can no longer restore this pubky.",
    ]);
    expect(dialog).not.toHaveTextContent("keep your encrypted key in your iCloud");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue with Apple" }));
    expect(onConnect).toHaveBeenCalledOnce();
    expect(dialog).not.toHaveAttribute("open");
  });
});
