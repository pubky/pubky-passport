/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { formatBackupDate } from "./backupStatus";
import { IdentityOverview } from "./identityOverview";

const PUBLIC_IDENTITY = { publicKeyZ32: "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy" };
const BACKUP_AT = "2026-09-01T10:00:00.000Z";

function renderOverview(
  identity: LocalIdentityMetadata,
  onRemoveIdentity: () => LocalIdentityResult<void> = () => Result.ok(),
) {
  const callbacks = {
    onBackup: vi.fn(),
    onEditProfile: vi.fn(),
    onManage: vi.fn(),
    onRemoveIdentity: vi.fn(onRemoveIdentity),
    onRemoved: vi.fn(),
    onSwitch: vi.fn(),
    onVerifyBackup: vi.fn(),
  };
  render(<IdentityOverview identity={identity} onAuthorize={vi.fn()} {...callbacks} />);
  return callbacks;
}

describe("IdentityOverview", () => {
  afterEach(cleanup);

  it("asks to back up a browser key that has no backup, with one warning", () => {
    const { onBackup } = renderOverview({ publicIdentity: PUBLIC_IDENTITY });

    // A key only in this browser gets no tag; the notice alone carries the warning.
    expect(screen.queryByText("Key in this browser")).toBeNull();
    expect(document.querySelectorAll('[data-tone="warning"]')).toHaveLength(1);
    const reminder = screen
      .getByText(/This key is saved only in this browser/u)
      .closest("[data-tone]");
    expect(reminder).toHaveAttribute("data-tone", "warning");
    expect(screen.queryByRole("button", { name: "Check recovery file" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(onBackup).toHaveBeenCalledOnce();
  });

  it("asks to check a backup file that was never opened, or to make a new one", () => {
    const { onBackup, onVerifyBackup } = renderOverview({
      publicIdentity: PUBLIC_IDENTITY,
      backup: { createdAt: BACKUP_AT },
    });

    const reminder = screen.getByText(/but it was never checked/u).closest("[data-tone]");
    expect(reminder).toHaveAttribute("data-tone", "warning");
    expect(reminder).toHaveTextContent(
      `Passport made a recovery file on ${formatBackupDate(new Date(BACKUP_AT))}`,
    );
    // Checking it opens Verify your backup.
    fireEvent.click(screen.getByRole("button", { name: "Check recovery file" }));
    expect(onVerifyBackup).toHaveBeenCalledOnce();
    expect(onBackup).not.toHaveBeenCalled();
    // The download may never have been saved, so a new file is one tap away too.
    fireEvent.click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(onBackup).toHaveBeenCalledOnce();
  });

  it("leaves a checked backup file to Manage and shows no tag for a key only in this browser", () => {
    renderOverview({ publicIdentity: PUBLIC_IDENTITY, backup: { verifiedAt: BACKUP_AT } });

    expect(screen.queryByText(/Recovery file checked/u)).toBeNull();
    expect(screen.queryByText(/Key in this browser/u)).toBeNull();
    expect(document.querySelector('[data-tone="warning"]')).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Download recovery file" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check recovery file" })).not.toBeInTheDocument();
  });

  it.each([
    [
      "a Google account",
      {
        googleAccount: {
          googleSubject: "subject",
          email: "person@example.com",
          name: "Person",
          pictureUrl: null,
        },
      },
      null,
    ],
    ["Pubky Ring", { keySource: "ring" } as const, "Key in Pubky Ring"],
  ])("shows at most the Ring tag when %s holds the key", (_, protection, tag) => {
    renderOverview({ publicIdentity: PUBLIC_IDENTITY, ...protection });

    // The Google card below names the account; the overview leaves the Google badge out.
    expect(screen.queryByRole("group", { name: /^Attached Google account/u })).toBeNull();
    if (tag) expect(screen.getByText(tag)).toBeInTheDocument();
    expect(screen.queryByText(/backed up to Google Drive/u)).toBeNull();
    expect(document.querySelector('[data-tone="warning"]')).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Download recovery file" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["Set up profile", { profileSetupRequired: true } as const],
    ["Edit profile", {}],
  ])("is for the profile only when Pubky Ring holds the key: %s", (action, setup) => {
    const { onEditProfile } = renderOverview({
      publicIdentity: PUBLIC_IDENTITY,
      keySource: "ring",
      ...setup,
    });

    // Passport cannot sign with this key, so nothing here authorizes an app or handles the key.
    expect(screen.queryByRole("button", { name: "Authorize an app" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /recovery file/u })).not.toBeInTheDocument();
    expect(screen.getByText(PUBLIC_IDENTITY.publicKeyZ32)).toBeInTheDocument();
    // It has nothing to manage: Log out takes Manage's place, beside Switch.
    expect(screen.getAllByRole("button").map((button) => button.textContent?.trim())).toEqual([
      action,
      "Log out",
      "Switch",
    ]);
    expect(screen.queryByRole("button", { name: "Manage identity" })).not.toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "Log out" });
    expect(remove.parentElement).toBe(
      screen.getByRole("button", { name: "Switch identity" }).parentElement,
    );
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(onEditProfile).toHaveBeenCalledOnce();
  });

  it("logs a Ring identity out through the same confirmation Manage used, and Cancel returns", () => {
    const { onManage, onRemoveIdentity, onRemoved } = renderOverview({
      publicIdentity: PUBLIC_IDENTITY,
      keySource: "ring",
    });

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(
      screen.getByRole("heading", { name: "Remove this identity from this browser?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/removes the saved identity from this browser/u)).toBeInTheDocument();
    expect(screen.getByText(/Your key stays in Pubky Ring/u)).toBeInTheDocument();
    // The key stays in Ring, so there is nothing to acknowledge.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    expect(onRemoveIdentity).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from this browser" }));
    expect(onRemoveIdentity).toHaveBeenCalledOnce();
    expect(onRemoved).toHaveBeenCalledOnce();
    expect(onManage).not.toHaveBeenCalled();
  });

  it("says so and stays when a Ring identity could not be removed", () => {
    const { onRemoved } = renderOverview(
      { publicIdentity: PUBLIC_IDENTITY, keySource: "ring" },
      () => Result.err({ code: "storage_unavailable" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from this browser" }));
    expect(
      screen.getByText("Could not remove the identity. Nothing was deleted. Please try again."),
    ).toBeInTheDocument();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("keeps Manage, and no removal of its own, for a key this browser holds", () => {
    const { onManage } = renderOverview({
      publicIdentity: PUBLIC_IDENTITY,
      backup: { verifiedAt: BACKUP_AT },
    });
    expect(
      screen.queryByRole("button", { name: /Log out|Remove from this browser/u }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage identity" }));
    expect(onManage).toHaveBeenCalledOnce();
  });

  it("authorizes apps with a key this browser holds, and offers profile setup beside it", () => {
    const { onEditProfile } = renderOverview({
      publicIdentity: PUBLIC_IDENTITY,
      googleAccount: {
        googleSubject: "subject",
        email: "p@example.com",
        name: "P",
        pictureUrl: null,
      },
      profileSetupRequired: true,
    });

    expect(screen.getByRole("button", { name: "Authorize an app" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set up profile" }));
    expect(onEditProfile).toHaveBeenCalledOnce();
  });

  it("names an identity without a profile after its key, with pubky.app's face for the key", () => {
    renderOverview({ publicIdentity: PUBLIC_IDENTITY });

    expect(screen.getByRole("heading", { level: 2, name: "Pubky 1aeh…dwdy" })).toBeVisible();
    expect(screen.queryByText("Your Pubky")).toBeNull();
    // The key's first character is its mouth.
    expect(document.querySelector("[data-facehash]")).toHaveTextContent(/^1$/u);
  });

  it("gives a named identity without a picture the same face, with its name's initial", () => {
    renderOverview({ publicIdentity: PUBLIC_IDENTITY, profile: { name: "Satoshi" } });

    expect(screen.getByRole("heading", { level: 2, name: "Satoshi" })).toBeVisible();
    expect(document.querySelector("[data-facehash]")).toHaveTextContent(/^S$/u);
    expect(screen.queryByText("SA")).toBeNull();
  });

  it("shows the profile picture instead of the face", () => {
    renderOverview({
      publicIdentity: PUBLIC_IDENTITY,
      profile: { name: "Satoshi" },
      avatarUrl: "blob:avatar",
    });

    expect(document.querySelector("img")).toHaveAttribute("src", "blob:avatar");
    expect(document.querySelector("[data-facehash]")).toBeNull();
  });
});
