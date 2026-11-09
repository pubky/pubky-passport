/** @vitest-environment jsdom */

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fakeAppleIdentityController,
  TEST_APPLE_CONFIGURATION,
} from "@test-utils/fakeAppleIdentityController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import { AppleIdentityConfigurationProvider } from "@/client/ui/appleIdentityConfiguration";
import { IdentityEstablishmentFlow } from "./identityEstablishmentFlow";

const PUBKY = "o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy";

function renderFlow({
  apple = TEST_APPLE_CONFIGURATION,
  forAuthorization = false,
  onComplete = vi.fn(),
}: {
  apple?: typeof TEST_APPLE_CONFIGURATION | null;
  forAuthorization?: boolean;
  onComplete?: () => void;
} = {}) {
  const fake = fakeAppleIdentityController();
  const google = mockGoogleIdentityController();
  const createAppleIdentityController = vi.fn(() => fake.controller);
  const createGoogleIdentityController = vi.fn(() => google);
  render(
    withPassportTestProviders(
      <AppleIdentityConfigurationProvider apple={apple}>
        <IdentityEstablishmentFlow forAuthorization={forAuthorization} onComplete={onComplete} />
      </AppleIdentityConfigurationProvider>,
      {
        createAppleIdentityController,
        createGoogleIdentityController,
      },
    ),
  );
  return { createAppleIdentityController, createGoogleIdentityController, fake };
}

describe("Apple onboarding", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("is hidden while Apple login is off", () => {
    const { createAppleIdentityController } = renderFlow({ apple: null });
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    expect(screen.getByText(/Use your existing accounts to sign in/u)).toBeInTheDocument();
    expect(createAppleIdentityController).not.toHaveBeenCalled();
    expect(screen.queryByText("Choose an account to sign in with")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Choose an account to sign in with" }),
    ).not.toBeInTheDocument();
  });

  it("presents Apple and Google as one choice, Google first", () => {
    renderFlow();
    const choice = screen.getByRole("group", { name: "Choose an account to sign in with" });
    const [google, apple, ...rest] = within(choice).getAllByRole("button", {
      name: /^Continue with/u,
    });
    expect(apple).toHaveAccessibleName("Continue with Apple");
    expect(google).toHaveAccessibleName("Continue with Google");
    expect(rest).toEqual([]);
  });

  it("offers Apple next to Google without loading any Apple script", async () => {
    const { fake } = renderFlow();
    expect(screen.getByText(/Use your existing accounts to sign in/u)).toBeInTheDocument();
    expect(document.querySelectorAll("script[src*='apple']")).toHaveLength(0);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(fake.controller.continueWithApple).toHaveBeenCalledOnce();
  });

  it("asks for the second click on Connect iCloud", async () => {
    const { fake } = renderFlow();
    act(() => fake.emit({ status: "requesting-apple" }));
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Apple...");

    act(() => fake.emit({ status: "connect-icloud", ready: false }));
    expect(
      screen.getByRole("heading", { name: "Signed in with Apple. One more step." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeDisabled();

    act(() => fake.emit({ status: "connect-icloud", ready: true, notice: "icloud_popup_blocked" }));
    expect(screen.getByText(/blocked the iCloud window/u)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(fake.controller.connectICloud).toHaveBeenCalledOnce();

    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(fake.controller.reset).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeInTheDocument();
  });

  it("keeps step instructions in the flow and natural window actions routed to their original callbacks", async () => {
    const { fake } = renderFlow();
    act(() => fake.emit({ status: "requesting-apple" }));
    expect(screen.getByText("Step 1 of 2: sign in with Apple")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Return to Apple’s window" }));
    expect(fake.controller.focusSignIn).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Cancel and try again" }));
    expect(fake.controller.cancelSignIn).toHaveBeenCalledOnce();

    act(() => fake.emit({ status: "connect-icloud", ready: true }));
    expect(screen.getByText("Step 2 of 2: connect to iCloud")).toBeInTheDocument();
    expect(
      screen.getByText("Allow Passport to use iCloud for your encrypted backup."),
    ).toBeInTheDocument();
    act(() => fake.emit({ status: "connecting-icloud" }));
    expect(
      screen.getByText(
        "In Apple’s window, allow Passport to use iCloud for your encrypted backup.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Return to Apple’s window" }));
    expect(fake.controller.focusICloud).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Cancel and try again" }));
    expect(fake.controller.cancelICloud).toHaveBeenCalledOnce();
  });

  it("shows progress, then the created identity with the Apple Account", async () => {
    const onComplete = vi.fn();
    const { fake } = renderFlow({ onComplete });
    act(() =>
      fake.emit({ status: "establishing", progress: { flow: "create", step: "signing_up" } }),
    );
    expect(screen.getByText("Check iCloud for a backup")).toBeInTheDocument();

    act(() =>
      fake.emit({
        status: "established",
        identity: {
          establishmentMode: "created",
          appleAccount: {
            appleSubject: "001234.abcdef.1234",
            email: "abc123@privaterelay.appleid.com",
            name: "Jane Appleseed",
          },
          publicIdentity: { publicKeyZ32: PUBKY },
        },
      }),
    );
    expect(screen.getByText("Stored backup in iCloud.")).toBeInTheDocument();
    expect(screen.getByText("Jane Appleseed")).toBeInTheDocument();
    expect(screen.getByText("abc123@privaterelay.appleid.com")).toBeInTheDocument();
    expect(screen.queryByText("001234.abcdef.1234")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("moves straight on after a restore", () => {
    const onComplete = vi.fn();
    const { fake } = renderFlow({ onComplete });
    act(() =>
      fake.emit({
        status: "established",
        identity: {
          establishmentMode: "restored",
          appleAccount: { appleSubject: "001234.abcdef.1234", email: null, name: null },
          publicIdentity: { publicKeyZ32: PUBKY },
        },
      }),
    );
    expect(onComplete).toHaveBeenCalledOnce();
    // Nothing is shown on the way: no completion screen and no provider choice.
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });

  it("explains failures and offers replacement only for verified file problems", async () => {
    const { fake } = renderFlow();
    act(() =>
      fake.emit({
        status: "failed",
        error: { code: "icloud_account_mismatch" },
        appleEmail: "jane@example.com",
      }),
    );
    expect(screen.getByText(/different Apple Account/u)).toBeInTheDocument();
    expect(screen.getByText("You signed in with Apple as jane@example.com.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/u })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(fake.controller.continueWithApple).toHaveBeenCalledOnce();

    act(() => fake.emit({ status: "failed", error: { code: "invalid_passport_file" } }));
    await userEvent.setup().click(screen.getByRole("button", { name: /Delete/u }));
    expect(screen.getByRole("heading", { name: "Permanently replace identity?" })).toBeVisible();
  });

  it("shows the account type when Apple sent no name or email", () => {
    const { fake } = renderFlow();
    act(() =>
      fake.emit({
        status: "established",
        identity: {
          establishmentMode: "created",
          appleAccount: { appleSubject: "001234.abcdef.1234", email: null, name: null },
          publicIdentity: { publicKeyZ32: PUBKY },
        },
      }),
    );
    expect(screen.getByText("Apple Account")).toBeInTheDocument();
    expect(screen.getByText("Key stored in iCloud")).toBeInTheDocument();
  });

  it("shows the email alone when Apple sent no name", () => {
    const { fake } = renderFlow();
    act(() =>
      fake.emit({
        status: "established",
        identity: {
          establishmentMode: "created",
          appleAccount: {
            appleSubject: "001234.abcdef.1234",
            email: "jane@icloud.com",
            name: null,
          },
          publicIdentity: { publicKeyZ32: PUBKY },
        },
      }),
    );
    expect(screen.getByText("jane@icloud.com")).toBeInTheDocument();
    expect(screen.getByText("Key stored in iCloud")).toBeInTheDocument();
  });

  it("lets an authorization choose instead of starting Google automatically", () => {
    const { createGoogleIdentityController } = renderFlow({ forAuthorization: true });
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(createGoogleIdentityController).not.toHaveBeenCalled();
  });
});
