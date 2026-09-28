/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { ProfileErrorCode, ProfileResult } from "@/client/logic/profile/ProfileController";
import type { LoadedProfile, PubkyProfile } from "@/client/logic/profile/profile";
import type { IdentityCatalogActions } from "@/client/ui/identity-catalog/useIdentityCatalog";
import { ProfileSetupFlow } from "./profileSetupFlow";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const load = vi.fn<(key: string) => Promise<ProfileResult<LoadedProfile | null>>>();
const save =
  vi.fn<
    (key: string, profile: PubkyProfile, avatar?: File) => Promise<ProfileResult<PubkyProfile>>
  >();
const actions = {} as IdentityCatalogActions;

function mount(
  identity: Partial<LocalIdentityMetadata> = {},
  handlers: { onReconnect?: () => void } = {},
) {
  const onBack = vi.fn();
  const onComplete = vi.fn();
  const onDefer = vi.fn();
  render(
    <ProfileSetupFlow
      identity={{ publicIdentity: { publicKeyZ32: KEY }, ...identity }}
      controller={{ load, save }}
      actions={actions}
      onBack={onBack}
      onComplete={onComplete}
      onDefer={onDefer}
      {...handlers}
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
    expect(screen.getByRole("status")).toHaveTextContent("could not be read");
    await userEvent.setup().click(screen.getByRole("button", { name: "Finish" }));
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
    expect(await screen.findByText(/Could not load your profile/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Name")).toHaveValue("");
    expect(load).toHaveBeenCalledTimes(2);
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
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Connect Ring" })).not.toBeInTheDocument();
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

  it("goes back through the backup step during setup, then leaves instead of looping", async () => {
    const { onBack } = mount({ profileSetupRequired: true });
    const user = userEvent.setup();
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Choose backup method" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("skips the key backup step for a Google-backed identity", async () => {
    const { onBack } = mount({
      profileSetupRequired: true,
      googleAccount: {
        name: "Google name",
        email: "google@example.com",
        googleSubject: "subject",
        pictureUrl: null,
      },
    });
    await screen.findByLabelText("Name");
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole("heading", { name: "Choose backup method" })).not.toBeInTheDocument();
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
