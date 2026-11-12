/** @vitest-environment jsdom */

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fakeAppleIdentityController,
  TEST_APPLE_CONFIGURATION,
} from "@test-utils/fakeAppleIdentityController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import type { GoogleIdentityControllerPort } from "@/client/ui/passportCollaborators";
import { AppleIdentityConfigurationProvider } from "@/client/ui/appleIdentityConfiguration";
import { AttachProviderFlow } from "./attachProviderFlow";

const PUBKY = "o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy";
const IDENTITY = { publicIdentity: { publicKeyZ32: PUBKY } };
const GOOGLE_ACCOUNT = {
  googleSubject: "google-subject",
  email: "user@example.com",
  name: "Gil",
  pictureUrl: null,
};
const APPLE_ACCOUNT = { appleSubject: "001234.abc", email: "jane@example.com", name: "Jane" };

type AttachGoogle = GoogleIdentityControllerPort["attachIdentity"];

function renderAttach({
  apple = TEST_APPLE_CONFIGURATION,
  attachIdentity,
}: {
  apple?: typeof TEST_APPLE_CONFIGURATION | null;
  attachIdentity?: AttachGoogle;
} = {}) {
  const appleFake = fakeAppleIdentityController();
  const google = mockGoogleIdentityController(attachIdentity ? { attachIdentity } : {});
  const onBack = vi.fn();
  const onDone = vi.fn();
  render(
    withPassportTestProviders(
      <AppleIdentityConfigurationProvider apple={apple}>
        <AttachProviderFlow identity={IDENTITY} onBack={onBack} onDone={onDone} />
      </AppleIdentityConfigurationProvider>,
      {
        createAppleIdentityController: () => appleFake.controller,
        createGoogleIdentityController: () => google,
      },
    ),
  );
  return { appleFake, google, onBack, onDone };
}

describe("AttachProviderFlow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers Google and Apple with help, the Terms notice, the pubky and Back", async () => {
    const user = userEvent.setup();
    const { onBack } = renderAttach();

    expect(screen.getByRole("heading", { name: "Connect an account." })).toBeInTheDocument();
    expect(screen.getByText(PUBKY)).toBeInTheDocument();
    const choice = screen.getByRole("group", { name: "Choose an account to sign in with" });
    expect(within(choice).getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(within(choice).getByRole("button", { name: "Continue with Apple" })).toBeVisible();
    expect(screen.getByRole("button", { name: "How Google sign-in works" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "How Apple sign-in works" })).toBeInTheDocument();
    expect(screen.getByText(/By continuing, you agree to the Pubky Passport/u)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("hides Apple while Apple login is off", () => {
    renderAttach({ apple: null });

    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).toBeNull();
    expect(screen.getByText(/Back up this pubky in your Google Drive\./u)).toBeInTheDocument();
  });

  it("attaches with Google and shows the account before returning", async () => {
    const user = userEvent.setup();
    const attachIdentity = vi.fn<AttachGoogle>(async (publicIdentity) =>
      Result.ok({
        attachment: "created" as const,
        googleAccount: GOOGLE_ACCOUNT,
        publicIdentity,
        visibleRecoveryCopyStatus: "created" as const,
      }),
    );
    const { onDone } = renderAttach({ attachIdentity });

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(attachIdentity).toHaveBeenCalledWith(IDENTITY.publicIdentity);
    expect(
      await screen.findByRole("heading", { name: "Connected to Google." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Stored backup in Google Drive.")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText(PUBKY)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("says when Drive already held the backup and when no visible copy was made", async () => {
    const user = userEvent.setup();
    const linked = vi.fn<AttachGoogle>(async (publicIdentity) =>
      Result.ok({
        attachment: "linked" as const,
        googleAccount: GOOGLE_ACCOUNT,
        publicIdentity,
        visibleRecoveryCopyStatus: "skipped" as const,
      }),
    );
    renderAttach({ attachIdentity: linked });
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(
      await screen.findByText("Google Drive already held the backup of this pubky."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();

    const skipped = vi.fn<AttachGoogle>(async (publicIdentity) =>
      Result.ok({
        attachment: "created" as const,
        googleAccount: GOOGLE_ACCOUNT,
        publicIdentity,
        visibleRecoveryCopyStatus: "skipped" as const,
      }),
    );
    renderAttach({ attachIdentity: skipped });
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/No visible recovery copy/u);
  });

  it("refuses an account that holds another pubky, then lets the person go back", async () => {
    const user = userEvent.setup();
    const attachIdentity = vi.fn<AttachGoogle>(async () =>
      Result.err({ code: "provider_account_in_use" as const }),
    );
    renderAttach({ attachIdentity });

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Account in use." })).toBeInTheDocument();
    expect(screen.getByText(/already holds another pubky/u)).toBeInTheDocument();
    expect(screen.getByText(/Detach that pubky from Google first/u)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was changed/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Connect an account." })).toBeInTheDocument();
  });

  it("lets Try again use another Google account", async () => {
    const user = userEvent.setup();
    const attachIdentity = vi.fn<AttachGoogle>(async () =>
      Result.err({ code: "provider_account_in_use" as const }),
    );
    const { google } = renderAttach({ attachIdentity });
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    await screen.findByRole("heading", { name: "Account in use." });

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(google.reset).toHaveBeenCalledOnce();
    expect(attachIdentity).toHaveBeenCalledTimes(2);
  });

  it("does not claim nothing changed once the backup was stored", async () => {
    const user = userEvent.setup();
    const attachIdentity = vi.fn<AttachGoogle>(async () =>
      Result.err({ code: "local_link_failed" as const }),
    );
    renderAttach({ attachIdentity });

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText(/backup is in Google Drive/u)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing was changed/u)).toBeNull();
  });

  it("does not claim nothing changed after an upload that may have gone through", async () => {
    const user = userEvent.setup();
    const attachIdentity = vi.fn<AttachGoogle>(async () =>
      Result.err({ code: "drive_create_conflict" as const }),
    );
    renderAttach({ attachIdentity });

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText("drive_create_conflict")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing was changed/u)).toBeNull();
  });

  it("shows other failures with their code, a retry and Back", async () => {
    const user = userEvent.setup();
    const attachIdentity = vi.fn<AttachGoogle>(async () =>
      Result.err({ code: "invalid_passport_file" as const }),
    );
    renderAttach({ attachIdentity });

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Not connected." })).toBeInTheDocument();
    expect(screen.getByText("invalid_passport_file")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/u })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(attachIdentity).toHaveBeenCalledTimes(2);
  });

  it("asks for the Drive permission again when it was not granted", async () => {
    const user = userEvent.setup();
    const attachIdentity = vi.fn<AttachGoogle>(async () =>
      Result.err({ code: "google_drive_access_required" as const }),
    );
    renderAttach({ attachIdentity });

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(
      await screen.findByRole("heading", { name: "Drive access required." }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Connect an account." })).toBeInTheDocument();
  });

  it("shows Google's waiting and saving screens", async () => {
    const user = userEvent.setup();
    const { google } = renderAttach({
      attachIdentity: vi.fn<AttachGoogle>(() => new Promise(() => undefined)),
    });

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(screen.getByText(/back up this pubky in your Google Drive/u)).toBeInTheDocument();
    act(() => google.emitState({ status: "attaching" }));
    expect(screen.getByRole("heading", { name: "Saving backup." })).toBeInTheDocument();
    expect(screen.getByText(/saving the encrypted backup in Google Drive/u)).toBeInTheDocument();
  });

  it("runs Apple's two steps and completes with the Apple Account", async () => {
    const user = userEvent.setup();
    const { appleFake, onDone } = renderAttach();
    act(() => appleFake.emit({ status: "idle" }));

    await user.click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(appleFake.controller.attachIdentity).toHaveBeenCalledWith(IDENTITY.publicIdentity);

    act(() => appleFake.emit({ status: "requesting-apple" }));
    expect(screen.getByText("Step 1 of 2: sign in with Apple")).toBeInTheDocument();
    act(() => appleFake.emit({ status: "connect-icloud", ready: true }));
    expect(screen.getByText("Step 2 of 2: connect to iCloud")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(appleFake.controller.connectICloud).toHaveBeenCalledOnce();
    act(() => appleFake.emit({ status: "attaching" }));
    expect(screen.getByText(/saving the encrypted backup in iCloud/u)).toBeInTheDocument();
    act(() =>
      appleFake.emit({
        status: "attached",
        identity: {
          attachment: "created",
          appleAccount: APPLE_ACCOUNT,
          publicIdentity: IDENTITY.publicIdentity,
        },
      }),
    );
    expect(screen.getByRole("heading", { name: "Connected to Apple." })).toBeInTheDocument();
    expect(screen.getByText("Stored backup in iCloud.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/only together with the iCloud/u);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("names the Apple Account that already holds another pubky; Back resets Apple", async () => {
    const user = userEvent.setup();
    const { appleFake } = renderAttach();
    act(() =>
      appleFake.emit({
        status: "failed",
        error: { code: "provider_account_in_use" },
        appleEmail: "jane@example.com",
      }),
    );

    expect(screen.getByRole("heading", { name: "Account in use." })).toBeInTheDocument();
    expect(screen.getByText(/This Apple Account already holds another pubky/u)).toBeVisible();
    expect(screen.getByText("You signed in with Apple as jane@example.com.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(appleFake.controller.reset).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Connect an account." })).toBeInTheDocument();
  });

  it("goes back from Connect iCloud without attaching", async () => {
    const user = userEvent.setup();
    const { appleFake } = renderAttach();
    act(() => appleFake.emit({ status: "connect-icloud", ready: true }));

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(appleFake.controller.reset).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Connect an account." })).toBeInTheDocument();
  });
});
