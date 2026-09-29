/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { ProfileErrorCode, ProfileResult } from "@/client/logic/profile/ProfileController";
import type { LoadedProfile, PubkyProfile } from "@/client/logic/profile/profile";
import { ProfileSetupFlow } from "./profileSetupFlow";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const load = vi.fn<(key: string) => Promise<ProfileResult<LoadedProfile | null>>>();
const save =
  vi.fn<
    (key: string, profile: PubkyProfile, avatar?: File) => Promise<ProfileResult<PubkyProfile>>
  >();

/** Opened from Manage or the overview by default; `afterAddition` opens it as creation does. */
function mount(
  identity: Partial<LocalIdentityMetadata> = {},
  handlers: { onReconnect?: () => void; afterAddition?: boolean } = {},
) {
  const onBack = vi.fn();
  const onComplete = vi.fn();
  const onDefer = vi.fn();
  const { afterAddition = false, ...rest } = handlers;
  render(
    <ProfileSetupFlow
      identity={{ publicIdentity: { publicKeyZ32: KEY }, ...identity }}
      controller={{ load, save }}
      onBack={afterAddition ? undefined : onBack}
      onComplete={onComplete}
      onDefer={afterAddition ? onDefer : undefined}
      {...rest}
    />,
  );
  return { onBack, onComplete, onDefer };
}
beforeEach(() => {
  load.mockResolvedValue(Result.ok(null));
  save.mockResolvedValue(Result.ok({ name: "Satoshi" }));
  URL.createObjectURL = vi.fn(() => "blob:avatar");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProfileSetupFlow", () => {
  it("opens an empty form over an unreadable published profile and says saving replaces it", async () => {
    load.mockResolvedValue(Result.err({ code: "invalid_profile" }));
    const { onComplete } = mount({
      googleAccount: {
        name: "Google name",
        email: "google@example.com",
        googleSubject: "subject",
        pictureUrl: null,
      },
    });
    expect(await screen.findByLabelText("Name")).toHaveValue("Google name");
    const warning = screen.getByRole("status");
    expect(warning).toHaveAttribute("data-tone", "warning");
    expect(warning).toHaveTextContent("We couldn’t read your current profile.");
    expect(warning).toHaveTextContent("Saving here replaces it everywhere it’s shown.");
    // The button says it overwrites what other apps show, not just that setup ends.
    expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Replace profile" }));
    expect(save).toHaveBeenCalledWith(
      KEY,
      expect.objectContaining({ name: "Google name" }),
      undefined,
    );
    expect(onComplete).toHaveBeenCalledWith({ name: "Satoshi" }, undefined);
  });

  it("shows only a retry for a failed read", async () => {
    load.mockResolvedValueOnce(Result.err({ code: "load_failed" }));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load your profile/u);
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    // The retry is the primary action beside Back, not a small pill above it.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Back",
      "Try again",
    ]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    // The form replaces the focused retry, so focus moves into it rather than to the page.
    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("");
    expect(name).toHaveFocus();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed retry's button focused and busy while it runs", async () => {
    let failAgain!: () => void;
    load.mockResolvedValueOnce(Result.err({ code: "load_failed" })).mockReturnValueOnce(
      new Promise((resolve) => {
        failAgain = () => resolve(Result.err({ code: "load_failed" }));
      }),
    );
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(retry).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your profile…");
    await act(async () => failAgain());
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load your profile/u);
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
  });

  it("previews an existing avatar from its downloaded bytes", async () => {
    load.mockResolvedValue(
      Result.ok({ profile: { name: "Satoshi" }, avatar: new Blob(["png"], { type: "image/png" }) }),
    );
    mount();
    expect(await screen.findByRole("img", { name: "Profile avatar preview" })).toHaveAttribute(
      "src",
      "blob:avatar",
    );
  });

  it.each<[ProfileErrorCode, string]>([
    [
      "invalid_profile",
      "Use a name of 3–50 characters, a bio of up to 160 characters, and valid links with titles (up to 5).",
    ],
    ["invalid_avatar", "Passport could not use this image."],
    ["identity_unavailable", "no longer available in this browser"],
    ["storage_failed", "Your profile was published"],
    ["save_failed", "Check your connection and try again."],
    ["disconnected", "Your connection to Ring has ended."],
  ])("explains a %s save failure", async (code, message) => {
    save.mockResolvedValueOnce(Result.err({ code }));
    const { onComplete } = mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    // The failure appears above the actions and takes focus, so it is not missed.
    expect(alert).toHaveFocus();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Connect Ring" })).not.toBeInTheDocument();
  });

  it("shows an unsupported avatar's error by the picker and leaves focus there", async () => {
    mount();
    const picker = await screen.findByLabelText("Choose avatar file");
    picker.focus();

    fireEvent.change(picker, {
      target: { files: [new File(["%PDF"], "avatar.pdf", { type: "application/pdf" })] },
    });

    const message = screen.getByRole("alert");
    expect(message).toHaveTextContent("Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.");
    expect(picker).toHaveAccessibleDescription(
      "Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.",
    );
    expect(picker).toHaveAttribute("aria-invalid", "true");
    // A field error is not a failed save: focus stays on the picker for another choice.
    expect(picker).toHaveFocus();
    expect(message.closest("section")).toBe(screen.getByRole("region", { name: "Avatar" }));

    fireEvent.change(picker, {
      target: { files: [new File(["png"], "avatar.png", { type: "image/png" })] },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers to reconnect Ring after the grant has ended", async () => {
    save.mockResolvedValueOnce(Result.err({ code: "disconnected" }));
    const onReconnect = vi.fn();
    mount({ keySource: "ring" }, { onReconnect });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await user.click(await screen.findByRole("button", { name: "Connect Ring" }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it("stays silent about a save cancelled by its closed connection", async () => {
    save.mockResolvedValueOnce(Result.err({ code: "cancelled" }));
    const { onComplete } = mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("button", { name: "Finish" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each([
    ["a browser key", {}],
    [
      "a Google-backed identity",
      {
        googleAccount: {
          name: "Google name",
          email: "google@example.com",
          googleSubject: "subject",
          pictureUrl: null,
        },
      },
    ],
  ])("leaves required setup of %s straight away, without a backup detour", async (_, extra) => {
    const { onBack } = mount({ profileSetupRequired: true, ...extra });
    await screen.findByLabelText("Name");
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole("heading", { name: "Choose backup method" })).not.toBeInTheDocument();
  });

  it("offers Finish later as the one way on right after an identity was added", async () => {
    const { onDefer } = mount({ profileSetupRequired: true }, { afterAddition: true });
    await screen.findByLabelText("Name");
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    // Finish later takes Back's place beside Finish, so the pinned bar stays one row.
    const finishLater = screen.getByRole("button", { name: "Finish later" });
    expect(finishLater.parentElement).toBe(
      screen.getByRole("button", { name: "Finish" }).parentElement,
    );
    await userEvent.setup().click(finishLater);
    expect(onDefer).toHaveBeenCalledOnce();
  });

  it("offers only Back, no Finish later, when required setup was opened later", async () => {
    mount({ profileSetupRequired: true });
    await screen.findByLabelText("Name");
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish later" })).not.toBeInTheDocument();
  });

  it("keeps focused fields clear of the actions pinned to the window", async () => {
    mount();
    await screen.findByLabelText("Name");
    // The page's scroll padding below md applies while this bar is on screen (globals.css).
    expect(
      screen.getByRole("button", { name: "Finish" }).closest("[data-sticky-actions]"),
    ).not.toBeNull();
  });

  it("goes straight back when editing a finished profile", async () => {
    const { onBack } = mount();
    await screen.findByLabelText("Name");
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("caps links at the specification's limit", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Name");
    for (let added = 0; added < 3; added++)
      await user.click(screen.getByRole("button", { name: "Add link" }));
    expect(screen.queryByRole("button", { name: "Add link" })).not.toBeInTheDocument();
  });
});
