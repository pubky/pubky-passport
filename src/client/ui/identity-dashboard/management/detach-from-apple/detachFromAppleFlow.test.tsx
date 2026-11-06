/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fakeAppleIdentityController,
  TEST_APPLE_CONFIGURATION,
} from "@test-utils/fakeAppleIdentityController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { AppleIdentityConfigurationProvider } from "@/client/ui/appleIdentityConfiguration";
import { DetachFromProviderFlow } from "@/client/ui/identity-dashboard/management/detach-provider/detachFromProviderFlow";

const SUBJECT = "001234.abcdef.1234";
const APPLE_ACCOUNT = { appleSubject: SUBJECT, email: "jane@example.com", name: "Jane Appleseed" };
const IDENTITY = {
  appleAccount: APPLE_ACCOUNT,
  publicIdentity: { publicKeyZ32: "o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy" },
};

function renderDetach(apple: typeof TEST_APPLE_CONFIGURATION | null = TEST_APPLE_CONFIGURATION) {
  const fake = fakeAppleIdentityController();
  const onDone = vi.fn();
  render(
    withPassportTestProviders(
      <AppleIdentityConfigurationProvider apple={apple}>
        <DetachFromProviderFlow
          account={{ provider: "apple", appleAccount: APPLE_ACCOUNT }}
          createMigration={vi.fn()}
          createRecoveryFile={vi.fn()}
          identity={IDENTITY}
          onBack={vi.fn()}
          onDone={onDone}
        />
      </AppleIdentityConfigurationProvider>,
      { createAppleIdentityController: () => fake.controller },
    ),
  );
  return { fake, onDone };
}

describe("Detach from Apple", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("asks for a backup, a typed confirmation, then both Apple steps", async () => {
    const user = userEvent.setup();
    const { fake, onDone } = renderDetach();

    expect(screen.getByText(/If you remove Apple as a way/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "I backed up my pubky" }));
    expect(screen.getByRole("heading", { name: "Detach from Apple." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Apple Access" }));
    await user.type(screen.getByLabelText("Type DETACH to confirm"), "DETACH");
    await user.click(screen.getByRole("button", { name: "Confirm detachment" }));
    expect(fake.controller.detachIdentity).toHaveBeenCalledWith(IDENTITY.publicIdentity, SUBJECT);

    act(() => fake.emit({ status: "connect-icloud", ready: true }));
    expect(screen.getByText(/so Passport can delete it/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connect iCloud" }));
    expect(fake.controller.connectICloud).toHaveBeenCalledOnce();

    act(() => fake.emit({ status: "detached" }));
    expect(screen.getByRole("heading", { name: "Detached from Apple." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("shows a failure inside the confirmation", async () => {
    const user = userEvent.setup();
    const { fake } = renderDetach();
    await user.click(screen.getByRole("button", { name: "I backed up my pubky" }));
    await user.click(screen.getByRole("button", { name: "Remove Apple Access" }));
    act(() => fake.emit({ status: "failed", error: { code: "apple_account_mismatch" } }));
    expect(screen.getByText(/different Apple Account/u)).toBeInTheDocument();
  });

  it("explains that Apple login is off instead of offering a detach that cannot work", () => {
    renderDetach(null);
    expect(screen.getByRole("heading", { name: "Apple login unavailable." })).toBeInTheDocument();
  });
});
