/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalAccountSetupErrorCode } from "@/client/logic/local-account/LocalAccountSetupController";
import {
  LocalAccountCreationFlow,
  type InviteSource,
  type LocalAccountSetupPort,
} from "./localAccountCreationFlow";

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

function renderFlow(controller: LocalAccountSetupPort, inviteSource: InviteSource = "manual") {
  const onBack = vi.fn();
  const onAbandon = vi.fn();
  const onComplete = vi.fn();
  render(
    <LocalAccountCreationFlow
      invite={INVITE}
      inviteSource={inviteSource}
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
  await user.click(screen.getByRole("button", { name: "Download recovery file" }));
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

  it("prepares the account once the setup controller has loaded the SDK", async () => {
    const controller = fakeController();
    let finishLoading!: () => void;
    const view = render(
      <LocalAccountCreationFlow
        invite={INVITE}
        inviteSource="manual"
        onBack={vi.fn()}
        onComplete={vi.fn()}
        createSetupController={() =>
          new Promise((resolve) => {
            finishLoading = () => resolve(controller);
          })
        }
      />,
    );
    expect(screen.getByText("Preparing your pubky…")).toBeInTheDocument();
    expect(controller.prepareAccount).not.toHaveBeenCalled();

    finishLoading();
    expect(await screen.findByLabelText("Enter strong password")).toBeInTheDocument();
    expect(controller.prepareAccount).toHaveBeenCalledWith(INVITE);
    view.unmount();
    expect(controller.dispose).toHaveBeenCalled();
  });

  it("disposes a setup controller that finishes loading after the screen closed", async () => {
    const controller = fakeController();
    let finishLoading!: () => void;
    const view = render(
      <LocalAccountCreationFlow
        invite={INVITE}
        inviteSource="manual"
        onBack={vi.fn()}
        onComplete={vi.fn()}
        createSetupController={() =>
          new Promise((resolve) => {
            finishLoading = () => resolve(controller);
          })
        }
      />,
    );
    view.unmount();
    finishLoading();
    await vi.waitFor(() => expect(controller.dispose).toHaveBeenCalledOnce());
    expect(controller.prepareAccount).not.toHaveBeenCalled();
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
    // What happened in plain words, and that nothing the person holds was lost.
    expect(heading).toHaveAccessibleDescription(
      /couldn’t confirm your account with the homeserver, so it may or may not have been created/u,
    );
    expect(heading).toHaveAccessibleDescription(/Your recovery file still works/u);
    expect(screen.getByText("Your pubky")).toBeVisible();
    expect(screen.getByText("signin_failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    // No Back that quietly leads through the file check: the file check is named instead.
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check recovery file" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByText(/can only be restored from the recovery file/u)).toBeVisible();
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

  it("names the file check that the failure screen's side action returns to", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const controller = fakeController({ registerAccount: failRegistration("signin_failed") });
    renderFlow(controller);
    const user = userEvent.setup();
    await downloadAndSkip(user);
    await user.click(await screen.findByRole("button", { name: "Check recovery file" }));
    expect(
      await screen.findByRole("heading", { name: "Verify recovery file." }),
    ).toBeInTheDocument();
  });

  it("releases a rejected invite's key in one step and offers no retry", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const controller = fakeController({ registerAccount: failRegistration("invite_rejected") });
    const { onAbandon, onBack } = renderFlow(controller);
    const user = userEvent.setup();
    await downloadAndSkip(user);
    const heading = await screen.findByRole("heading", { name: "Invite not accepted." });
    expect(heading).toHaveAccessibleDescription(/didn’t accept this invite/u);
    expect(heading).toHaveAccessibleDescription(/Enter a different invite to continue/u);
    // The key owns nothing and is about to be discarded, so it is not shown.
    expect(screen.queryByText("Your pubky")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start over" })).not.toBeInTheDocument();
    // Going back would lead to verifying and resubmitting the rejected invite.
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enter a different invite" }));
    expect(controller.abandonAccount).toHaveBeenCalledOnce();
    expect(onAbandon).toHaveBeenCalledWith("invite_rejected");
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("calls a refused sign-up code from SMS or Lightning a verification, not an invite", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const controller = fakeController({ registerAccount: failRegistration("invite_rejected") });
    const { onAbandon, onBack } = renderFlow(controller, "homegate");
    const user = userEvent.setup();
    await downloadAndSkip(user);
    const heading = await screen.findByRole("heading", { name: "Verification not accepted." });
    expect(heading).toHaveAccessibleDescription(
      /didn’t accept the sign-up code your verification gave Passport/u,
    );
    expect(heading).toHaveAccessibleDescription(/Verify again to get a new sign-up code/u);
    expect(heading).not.toHaveAccessibleDescription(/invite/u);
    expect(screen.queryByRole("button", { name: /invite/u })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Verify again" }));
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
    expect(heading).toHaveAccessibleDescription(/so nothing was sent/u);
    // The usual cause, and what to change about it, instead of "free some storage".
    expect(heading).toHaveAccessibleDescription(/Allow site data \(or free up space\)/u);
    expect(heading).not.toHaveAccessibleDescription(/was created/u);
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

    await user.click(screen.getByRole("button", { name: "Try again" }));
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

  it("names no homeserver while the account is created on it", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    let finish!: () => void;
    const controller = fakeController({
      registerAccount: () =>
        new Promise((resolve) => {
          finish = () => resolve(Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }));
        }),
    });
    renderFlow(controller, "homegate");
    await downloadAndSkip(userEvent.setup());

    expect(await screen.findByRole("heading", { name: "Setting up your pubky." })).toBeVisible();
    // "Account created." names it once the account exists.
    expect(screen.queryByText("Homeserver")).toBeNull();
    expect(screen.queryByText(INVITE.homeserverPubky)).toBeNull();
    finish();
  });

  it("keeps the saved setup and names blocked storage when it refused the key", async () => {
    const controller = fakeController({
      prepareAccount: vi.fn(() => Result.err({ code: "storage_failed" as const })),
    });
    const { onBack } = renderFlow(controller);
    const heading = await screen.findByRole("heading", { name: "Setup failed." });
    // Storage refused the key, so the screen names the usual causes and what to change.
    expect(heading).toHaveAccessibleDescription(/private window/u);
    expect(heading).toHaveAccessibleDescription(/Allow site data for this site/u);
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(controller.discardUnregistered).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "the key could not be created",
      () =>
        fakeController({
          prepareAccount: vi.fn(() => Result.err({ code: "create_failed" as const })),
        }),
      "Passport couldn’t create a key in this browser. Try again. Any setup you saved earlier has been kept.",
    ],
    [
      "the code that creates keys did not load",
      () => Promise.reject(new Error("Loading chunk failed")),
      "Passport couldn’t load what it needs to create a key. Check your connection, then try again.",
    ],
  ] as const)("names no browser storage when %s", async (_, createSetupController, description) => {
    render(
      <LocalAccountCreationFlow
        invite={INVITE}
        inviteSource="manual"
        onBack={vi.fn()}
        onComplete={vi.fn()}
        createSetupController={createSetupController}
      />,
    );
    const heading = await screen.findByRole("heading", { name: "Setup failed." });
    expect(heading).toHaveAccessibleDescription(description);
    expect(heading).not.toHaveAccessibleDescription(/site data|private window/u);
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("prepares the key again on Try again instead of sending the person away", async () => {
    const controllers = [
      fakeController({
        prepareAccount: vi.fn(() => Result.err({ code: "create_failed" as const })),
      }),
      fakeController(),
    ];
    const createSetupController = vi.fn(
      () => controllers[createSetupController.mock.calls.length - 1]!,
    );
    const onBack = vi.fn();
    render(
      <LocalAccountCreationFlow
        invite={INVITE}
        inviteSource="manual"
        onBack={onBack}
        onComplete={vi.fn()}
        createSetupController={createSetupController}
      />,
    );
    await screen.findByRole("heading", { name: "Setup failed." });

    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Enter strong password")).toBeInTheDocument();
    expect(createSetupController).toHaveBeenCalledTimes(2);
    expect(controllers[0]!.dispose).toHaveBeenCalledOnce();
    expect(onBack).not.toHaveBeenCalled();
  });
});
