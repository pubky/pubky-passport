/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalAccountSetupErrorCode } from "@/client/logic/local-account/LocalAccountSetupController";
import { LocalAccountCreationFlow, type LocalAccountSetupPort } from "./localAccountCreationFlow";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const PUBLIC_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const INVITE = {
  homeserverPubky: "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo",
  signupToken: "invite-secret",
};
const PASSWORD = "correct horse battery";

type FakeController = { hasStartedRegistration: boolean };

function fakeController(overrides: Partial<LocalAccountSetupPort> = {}) {
  const state = { step: "password" as "password" | "confirm" };
  const controller = {
    get preparedStep() {
      return state.step;
    },
    hasStartedRegistration: false,
    prepareAccount: vi.fn(() => Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } })),
    createBackup: vi.fn(() => {
      state.step = "confirm";
      return Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "backup.pkarr" });
    }),
    verifyBackup: vi.fn(() => Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } })),
    skipVerification: vi.fn(() => Result.ok()),
    returnToBackup: vi.fn(() => {
      state.step = "password";
      return Result.ok();
    }),
    registerAccount: vi.fn(async function (this: FakeController) {
      this.hasStartedRegistration = true;
      return Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } });
    }),
    discardUnregistered: vi.fn(function (this: FakeController) {
      return this.hasStartedRegistration
        ? Result.err({ code: "registration_started" as const })
        : Result.ok(undefined);
    }),
    abandonAccount: vi.fn(() => Result.ok(undefined)),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as LocalAccountSetupPort & {
    registerAccount: ReturnType<typeof vi.fn>;
    discardUnregistered: ReturnType<typeof vi.fn>;
    abandonAccount: ReturnType<typeof vi.fn>;
  };
  return controller;
}

function renderFlow(controller: LocalAccountSetupPort) {
  const onBack = vi.fn();
  const onAbandon = vi.fn();
  const onComplete = vi.fn();
  render(
    <LocalAccountCreationFlow
      invite={INVITE}
      onBack={onBack}
      onAbandon={onAbandon}
      onComplete={onComplete}
      createSetupController={() => controller}
    />,
  );
  return { onBack, onAbandon, onComplete };
}

async function downloadAndSkip(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Enter strong password"), PASSWORD);
  await user.type(screen.getByLabelText("Confirm password"), PASSWORD);
  await user.click(screen.getByRole("button", { name: "Download encrypted backup" }));
  await user.click(
    await screen.findByRole("button", { name: "Skip this check (not recommended)" }),
  );
}

/**
 * Fails registration; unless nothing could be submitted, the invite counts as submitted. `started`
 * overrides that, as for an earlier attempt that already submitted the invite.
 */
function failRegistration(
  code: LocalAccountSetupErrorCode,
  started = code !== "draft_storage_failed" && code !== "homeserver_unreachable",
) {
  return vi.fn(async function (this: FakeController) {
    this.hasStartedRegistration = started;
    return Result.err({ code });
  });
}

describe("LocalAccountCreationFlow", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("forgets an unregistered draft when the user backs out of the password step", async () => {
    const controller = fakeController();
    const { onBack, onAbandon } = renderFlow(controller);
    const user = userEvent.setup();
    await screen.findByLabelText("Enter strong password");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(controller.discardUnregistered).toHaveBeenCalledOnce();
    expect(onAbandon).toHaveBeenCalledWith("user");
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("keeps a started registration when backing out and lets the parent lock the signer", async () => {
    const controller = fakeController({
      discardUnregistered: vi.fn(() => Result.err({ code: "registration_started" as const })),
    });
    const { onBack, onAbandon } = renderFlow(controller);
    const user = userEvent.setup();
    await screen.findByLabelText("Enter strong password");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onAbandon).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("confirms starting over once registration may have created an account", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const controller = fakeController({ registerAccount: failRegistration("signin_failed") });
    const { onBack, onAbandon } = renderFlow(controller);
    const user = userEvent.setup();
    await downloadAndSkip(user);
    const heading = await screen.findByRole("heading", { name: "Setup interrupted." });
    // Focus lands on the heading, which is described by the cause, so both are announced.
    expect(heading).toHaveFocus();
    expect(heading).toHaveAccessibleDescription(/Account state is uncertain/u);
    expect(screen.getByText("Your pubky")).toBeVisible();
    expect(screen.getByText("signin_failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry with this key" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByText(/can only be restored from the backup file/u)).toBeVisible();
    const remove = screen.getByRole("button", { name: "Remove key and start over" });
    expect(remove).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Type DELETE to confirm" }), "DELETE");
    await user.click(remove);
    expect(controller.abandonAccount).toHaveBeenCalledOnce();
    // The invite was submitted, so the parent must check it before offering it again.
    expect(onAbandon).toHaveBeenCalledWith("invite_submitted");
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("starts over without confirmation when the registration boundary was never saved", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const controller = fakeController({
      registerAccount: failRegistration("draft_storage_failed"),
    });
    const { onAbandon, onBack } = renderFlow(controller);
    const user = userEvent.setup();
    await downloadAndSkip(user);
    await user.click(await screen.findByRole("button", { name: "Start over" }));
    // The key owns no account, so there is nothing to warn about or confirm.
    expect(screen.queryByRole("textbox", { name: "Type DELETE to confirm" })).toBeNull();
    expect(controller.discardUnregistered).toHaveBeenCalledOnce();
    expect(controller.abandonAccount).not.toHaveBeenCalled();
    expect(onAbandon).toHaveBeenCalledWith("user");
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("confirms starting over when another tab submitted the invite meanwhile", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const controller = fakeController({
      registerAccount: failRegistration("homeserver_unreachable"),
      discardUnregistered: vi.fn(() => Result.err({ code: "registration_started" as const })),
    });
    const { onAbandon } = renderFlow(controller);
    const user = userEvent.setup();
    await downloadAndSkip(user);
    await user.click(await screen.findByRole("button", { name: "Start over" }));
    expect(screen.getByText(/may already own an account/u)).toBeVisible();
    expect(onAbandon).not.toHaveBeenCalled();
  });

  it("releases a rejected invite's key in one step and offers no retry", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const controller = fakeController({ registerAccount: failRegistration("invite_rejected") });
    const { onAbandon, onBack } = renderFlow(controller);
    const user = userEvent.setup();
    await downloadAndSkip(user);
    const heading = await screen.findByRole("heading", { name: "Invite rejected." });
    expect(heading).toHaveAccessibleDescription(/rejected this invite/u);
    // The key owns nothing and is about to be discarded, so it is not shown.
    expect(screen.queryByText("Your pubky")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry with this key" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start over" })).not.toBeInTheDocument();
    // Going back would lead to verifying and resubmitting the rejected invite.
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use another invite" }));
    expect(controller.abandonAccount).toHaveBeenCalledOnce();
    expect(onAbandon).toHaveBeenCalledWith("invite_rejected");
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("says nothing was submitted when the registration boundary could not be saved", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const controller = fakeController({
      registerAccount: failRegistration("draft_storage_failed"),
    });
    renderFlow(controller);
    await downloadAndSkip(userEvent.setup());
    const heading = await screen.findByRole("heading", { name: "Setup interrupted." });
    expect(heading).toHaveAccessibleDescription(/nothing was submitted/u);
    expect(heading).not.toHaveAccessibleDescription(/was verified/u);
  });

  it("offers a retry or a plain start over when a first attempt could not reach the homeserver", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const controller = fakeController({
      registerAccount: failRegistration("homeserver_unreachable"),
    });
    const { onAbandon, onBack } = renderFlow(controller);
    const user = userEvent.setup();
    await downloadAndSkip(user);
    const heading = await screen.findByRole("heading", { name: "Setup interrupted." });
    expect(heading).toHaveAccessibleDescription(/could not reach this invite's homeserver/u);
    expect(heading).toHaveAccessibleDescription(/nothing was submitted/u);
    expect(heading).not.toHaveAccessibleDescription(/uncertain/u);

    await user.click(screen.getByRole("button", { name: "Retry with this key" }));
    expect(controller.registerAccount).toHaveBeenCalledTimes(2);
    await user.click(await screen.findByRole("button", { name: "Start over" }));
    expect(screen.queryByRole("textbox", { name: "Type DELETE to confirm" })).toBeNull();
    expect(controller.discardUnregistered).toHaveBeenCalledOnce();
    expect(controller.abandonAccount).not.toHaveBeenCalled();
    expect(onAbandon).toHaveBeenCalledWith("user");
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("keeps the account warning when a retry after a submitted invite cannot reach the homeserver", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const controller = fakeController({
      registerAccount: failRegistration("homeserver_unreachable", true),
    });
    const { onAbandon } = renderFlow(controller);
    const user = userEvent.setup();
    await downloadAndSkip(user);
    const heading = await screen.findByRole("heading", { name: "Setup interrupted." });
    expect(heading).toHaveAccessibleDescription(/could not reach this invite's homeserver/u);
    expect(heading).toHaveAccessibleDescription(/this attempt sent nothing/u);
    expect(heading).not.toHaveAccessibleDescription(/nothing was submitted/u);

    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByText(/may already own an account/u)).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Type DELETE to confirm" }), "DELETE");
    await user.click(screen.getByRole("button", { name: "Remove key and start over" }));
    expect(controller.abandonAccount).toHaveBeenCalledOnce();
    expect(onAbandon).toHaveBeenCalledWith("invite_submitted");
  });

  it("completes registration and hands the identity to the parent", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const controller = fakeController();
    const { onComplete } = renderFlow(controller);
    await downloadAndSkip(userEvent.setup());
    expect(onComplete).toHaveBeenCalledWith({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } });
  });

  it("keeps the saved setup and reports failure when the key cannot be prepared", async () => {
    const controller = fakeController({
      prepareAccount: vi.fn(() => Result.err({ code: "create_failed" as const })),
    });
    const { onBack } = renderFlow(controller);
    expect(await screen.findByRole("heading", { name: "Setup failed." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(controller.discardUnregistered).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
