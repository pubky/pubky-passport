/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HowPassportWorks } from "./howPassportWorks";
import { ProviderChoice } from "./providerChoice";
import { SignInPage } from "./signInPage";

const TITLE = "Continue with your account, powered by Pubky Passport.";
const LEAD = "Use your existing accounts to sign in.";
const SETUP_BODY = [
  "Your provider: Your account provider helps you sign in and find your encrypted backup. It does not create or control your pubky.",
  "Your keys: Your keys are created in your browser and encrypted before they are saved in your cloud storage.",
  "Recovery: When you sign in, Passport retrieves your encrypted backup and the separate key needed to unlock it.",
  "Split security: Your encrypted backup and the key that unlocks it are stored separately.",
];

function renderControl() {
  render(<HowPassportWorks>{LEAD}</HowPassportWorks>);
  return screen.getByRole("button", { name: "How?" });
}

describe("HowPassportWorks", () => {
  afterEach(cleanup);

  it("ends the lead text with the existing How? control", () => {
    const trigger = renderControl();
    const lead = trigger.closest("p");
    expect(lead).toHaveTextContent(`${LEAD} How?`);
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(lead?.querySelector("div, h2, dialog")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders on the server as a closed control", () => {
    const markup = renderToStaticMarkup(<HowPassportWorks>{LEAD}</HowPassportWorks>);
    const shell = document.body.appendChild(document.createElement("div"));
    shell.innerHTML = markup;
    expect(within(shell).getByRole("button", { name: "How?" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(shell.querySelector("dialog")).not.toHaveAttribute("open");
    shell.remove();
  });

  it.each([false, true])(
    "renders identical natural setup bodies in How? and every available provider help (Apple=%s)",
    async (appleEnabled) => {
      const onGoogle = vi.fn();
      const onApple = vi.fn();
      render(
        <SignInPage>
          <ProviderChoice
            apple={appleEnabled ? { ready: true, onContinue: onApple } : null}
            onContinueWithGoogle={onGoogle}
          />
        </SignInPage>,
      );
      await userEvent.click(screen.getByRole("button", { name: "How?" }));
      const dialog = screen.getByRole("dialog", { name: TITLE });
      expect(dialog.tagName).toBe("DIALOG");
      expect(within(dialog).getByRole("heading", { level: 2, name: TITLE })).toHaveFocus();
      expect([...dialog.querySelectorAll("p > strong")].map((label) => label.textContent)).toEqual([
        "Your provider:",
        "Your keys:",
        "Recovery:",
        "Split security:",
      ]);
      expect(dialog.querySelectorAll("p")).toHaveLength(4);
      const sharedBody = [...dialog.querySelectorAll("p")].map((p) => p.textContent);
      expect(sharedBody).toEqual(SETUP_BODY);
      expect(dialog).not.toHaveTextContent(/Apple|Google|iCloud|Drive|recovery phrase/u);
      expect(within(dialog).getByRole("button", { name: "Continue" })).toBeEnabled();
      expect(within(dialog).getByRole("button", { name: "Learn more" })).toBeEnabled();
      await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      for (const provider of appleEnabled ? ["Google", "Apple"] : ["Google"]) {
        await userEvent.click(
          screen.getByRole("button", { name: `How ${provider} sign-in works` }),
        );
        const providerDialog = screen.getByRole("dialog", {
          name: `Continue with ${provider}, powered by Pubky Passport.`,
        });
        const providerBody = [...providerDialog.querySelectorAll("p")].map((p) => p.textContent);
        expect(providerBody).toEqual(SETUP_BODY);
        expect(providerBody).toEqual(sharedBody);
        expect(
          within(providerDialog).getByRole("button", { name: `Continue with ${provider}` }),
        ).toBeEnabled();
        await userEvent.click(within(providerDialog).getByRole("button", { name: "Close" }));
      }
      expect(onGoogle).not.toHaveBeenCalled();
      expect(onApple).not.toHaveBeenCalled();
    },
  );

  it("opens a useful, provider-neutral in-app guide from Learn more and returns to the overview", async () => {
    await userEvent.click(renderControl());
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Learn more" }));
    expect(within(dialog).getByRole("heading", { name: "How Passport works" })).toHaveFocus();
    expect(dialog).toHaveTextContent("On a new device");
    expect(dialog).toHaveTextContent("same account");
    expect(dialog).toHaveTextContent("download a password-protected recovery file");
    expect(dialog).not.toHaveTextContent(/Apple|Google|iCloud|Drive/u);
    await userEvent.click(within(dialog).getByRole("button", { name: "Back to overview" }));
    expect(within(dialog).getByRole("heading", { name: TITLE })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Learn more" })).toBeVisible();
  });

  it.each([false, true])(
    "Continue closes and focuses the available provider choices without starting auth (Apple=%s)",
    async (appleEnabled) => {
      const signIn = vi.fn();
      render(
        <SignInPage>
          <ProviderChoice
            apple={appleEnabled ? { ready: true, onContinue: signIn } : null}
            onContinueWithGoogle={signIn}
          />
        </SignInPage>,
      );
      await userEvent.click(screen.getByRole("button", { name: "How?" }));
      await userEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Continue" }),
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Available sign-in accounts" })).toHaveFocus();
      expect(signIn).not.toHaveBeenCalled();
    },
  );

  it("dismisses via the handle, Escape and backdrop, restores focus, and keeps body clicks open", async () => {
    const trigger = renderControl();
    const user = userEvent.setup();
    await user.click(trigger);
    expect(document.body.style.overflow).toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");

    await user.click(trigger);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("heading"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
