/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KEYCHAIN_APPS } from "@/client/ui/shared/brand/keychainBrands";
import { KeychainChoice } from "./keychainChoice";

type Props = Parameters<typeof KeychainChoice>[0];

function renderChoice(props: Partial<Props> = {}) {
  const callbacks = {
    onLeave: vi.fn(),
    onPassport: vi.fn(),
    onRing: vi.fn(),
  };
  render(
    <KeychainChoice
      checkingInvite={false}
      inviteSaved={false}
      registrationStarted={false}
      {...callbacks}
      {...props}
    />,
  );
  return callbacks;
}

/** The choice as the flow drives it: either way on checks the invite first. */
function CheckingChoice({ onPassport, onRing }: Pick<Props, "onPassport" | "onRing">) {
  const [checkingInvite, setCheckingInvite] = useState(false);
  return (
    <>
      <KeychainChoice
        checkingInvite={checkingInvite}
        inviteSaved={false}
        onLeave={vi.fn()}
        onPassport={() => {
          setCheckingInvite(true);
          return onPassport();
        }}
        onRing={() => {
          setCheckingInvite(true);
          onRing();
        }}
        registrationStarted={false}
      />
      <button onClick={() => setCheckingInvite(false)} type="button">
        Finish the check
      </button>
    </>
  );
}

describe("KeychainChoice", () => {
  afterEach(cleanup);

  it("presents both keychain apps in one card, each with its logo, its line and where to get it", () => {
    const { container } = render(
      <KeychainChoice
        checkingInvite={false}
        inviteSaved={false}
        onLeave={vi.fn()}
        onPassport={vi.fn()}
        onRing={vi.fn()}
        registrationStarted={false}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Pick your keychain." })).toBeVisible();
    expect(screen.getByText("Install a keychain for your identity keys.")).toBeVisible();
    // Either app reads the same request, so they share one card and one way on, never two choices.
    expect(screen.getAllByRole("region")).toHaveLength(1);
    const card = screen.getByRole("region", { name: "Keychain apps" });
    const lines = {
      "Pubky Ring":
        "Pubky Ring is a mobile keychain that enables you to securely authorize web services and apps.",
      Bitkit:
        "Bitkit is a simple, yet powerful self-custodial wallet, that also functions as keychain for the Pubky ecosystem.",
    } as const;
    expect(KEYCHAIN_APPS.map(({ name }) => name)).toEqual(Object.keys(lines));
    for (const { name, appStoreUrl, googlePlayUrl } of KEYCHAIN_APPS) {
      // Each app keeps its logo, its own line in the design's words and its badges together.
      const logo = within(card).getByRole("img", { name });
      const app = logo.parentElement!;
      expect(within(app).getByText(lines[name])).toBeVisible();
      // The logo names the app: no eyebrow repeats its name.
      expect(within(card).queryByText(name)).toBeNull();
      const appStore = within(app).getByRole("link", {
        name: `Download ${name} on the App Store`,
      });
      expect(appStore).toHaveAttribute("href", appStoreUrl);
      expect(appStore).toHaveAttribute("target", "_blank");
      const googlePlay = within(app).getByRole("link", { name: `Get ${name} on Google Play` });
      expect(googlePlay).toHaveAttribute("href", googlePlayUrl);
      expect(googlePlay).toHaveAttribute("target", "_blank");
    }
    // The apps stand in for any picture of scanning.
    expect(container.querySelector('img[src*="scan"]')).toBeNull();
    expect(within(card).getAllByRole("button")).toEqual([
      within(card).getByRole("button", { name: "Continue with keychain" }),
    ]);
    // Keeping the key here is a quiet link under the card, with no question in front of it.
    const browser = screen.getByRole("button", { name: "Keep key in this browser" });
    expect(card).not.toContainElement(browser);
    expect(card.compareDocumentPosition(browser) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/No phone at hand/u)).toBeNull();
  });

  it("continues with the keychain, showing the invite check on that button alone", async () => {
    const onRing = vi.fn();
    const onPassport = vi.fn();
    render(<CheckingChoice onPassport={onPassport} onRing={onRing} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Continue with keychain" }));

    expect(onRing).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Checking invite…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    // The other way waits on the same check, without showing it.
    const browser = screen.getByRole("button", { name: "Keep key in this browser" });
    expect(browser).toBeDisabled();
    expect(browser).not.toHaveAttribute("aria-busy");

    await user.click(screen.getByRole("button", { name: "Finish the check" }));
    expect(screen.getByRole("button", { name: "Continue with keychain" })).toBeEnabled();
    expect(onPassport).not.toHaveBeenCalled();
  });

  it("lists the tradeoffs before keeping the key in this browser", async () => {
    const onRing = vi.fn();
    const onPassport = vi.fn();
    render(<CheckingChoice onPassport={onPassport} onRing={onRing} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Keep key in this browser" }));
    const tradeoffs = screen.getByRole("dialog", { name: "Be aware of these tradeoffs:" });
    expect(
      within(tradeoffs)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Browser-based key generation",
      "Less secure than mobile keychain",
      "Suboptimal sign-in experience",
    ]);
    expect(onPassport).not.toHaveBeenCalled();

    // Cancel keeps the choice open, with nothing chosen.
    await user.click(within(tradeoffs).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onPassport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep key in this browser" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Create in browser anyway" }),
    );
    expect(onPassport).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The link that was pressed shows the invite check; the keychain's button only waits.
    expect(screen.getByRole("button", { name: "Checking invite…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("button", { name: "Continue with keychain" })).toBeDisabled();
    expect(onRing).not.toHaveBeenCalled();
  });

  it("leaves a started registration one way on: finishing it with the key in this browser", async () => {
    const { onLeave, onPassport } = renderChoice({ registrationStarted: true });
    const user = userEvent.setup();

    expect(screen.getByRole("heading", { level: 1, name: "Finish your account." })).toBeVisible();
    expect(
      screen.getByText(
        "You started creating an account with a key saved in this browser. Continue to finish it with that key.",
      ),
    ).toBeVisible();
    // Only that key can finish the account, so neither keychain nor tradeoffs are offered.
    expect(screen.queryByRole("button", { name: "Continue with keychain" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep key in this browser" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard verification" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onPassport).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("offers to discard a verification as a side action after Back, not while the invite is checked", async () => {
    const onDiscardInvite = vi.fn();
    renderChoice({ inviteSaved: true, onDiscardInvite });

    const discard = screen.getByRole("button", { name: "Discard verification" });
    expect(discard.closest('[data-slot="tertiary-actions"]')).not.toBeNull();
    const back = screen.getByRole("button", { name: "Back" });
    expect(back.compareDocumentPosition(discard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.setup().click(discard);
    expect(onDiscardInvite).toHaveBeenCalledOnce();
    cleanup();

    renderChoice({ checkingInvite: true, inviteSaved: true, onDiscardInvite: vi.fn() });
    expect(screen.getByRole("button", { name: "Discard verification" })).toBeDisabled();
    cleanup();

    // A typed invite is the person's own: nothing to discard.
    renderChoice();
    expect(screen.queryByRole("button", { name: "Discard verification" })).toBeNull();
  });

  it("goes Back to the invite entry while the invite can change, and otherwise leaves", async () => {
    const onBack = vi.fn();
    const { onLeave } = renderChoice({ onBack });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onLeave).not.toHaveBeenCalled();
    cleanup();

    const leaving = renderChoice();
    // Back, not Cancel: leaving account creation does not answer an app's request.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(leaving.onLeave).toHaveBeenCalledOnce();
  });

  it("says a just-made verification stays saved, only where Back leaves it behind", () => {
    renderChoice({ inviteSaved: true });
    expect(screen.getByText("Your verification stays saved in this browser.")).toBeVisible();
    cleanup();

    // Back to the invite entry leaves nothing behind.
    renderChoice({ inviteSaved: true, onBack: vi.fn() });
    expect(screen.queryByText("Your verification stays saved in this browser.")).toBeNull();
  });

  it.each([
    [
      "setup",
      "Welcome back. The setup you started is saved in this browser, so you can pick up where you left off.",
    ],
    [
      "verification",
      "Welcome back. Your verification is saved in this browser, so you don’t need to verify again.",
    ],
  ] as const)("welcomes back a %s an earlier visit left", (restored, welcome) => {
    renderChoice({ inviteSaved: true, restored });

    expect(screen.getByRole("status")).toHaveTextContent(welcome);
    // The welcome already says it is saved.
    expect(screen.queryByText("Your verification stays saved in this browser.")).toBeNull();
  });

  it("welcomes back a setup before asking to finish it", () => {
    renderChoice({ registrationStarted: true, restored: "setup" });
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Welcome back\. The setup you started is saved in this browser/u,
    );
  });

  it("shows why a choice failed as an alert that takes focus", () => {
    const error = "This invite has already been used. Use a different invite to continue.";
    renderChoice({ error });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(error);
    expect(alert).toHaveFocus();
  });
});
