/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { formatBackupDate } from "./backupStatus";
import { IdentityOverview } from "./identityOverview";

const PUBLIC_IDENTITY = { publicKeyZ32: "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy" };
const BACKUP_AT = "2026-09-01T10:00:00.000Z";

function renderOverview(identity: LocalIdentityMetadata) {
  const onBackup = vi.fn();
  render(
    <IdentityOverview
      identity={identity}
      onAuthorize={vi.fn()}
      onBackup={onBackup}
      onManage={vi.fn()}
      onSetUpProfile={vi.fn()}
      onSwitch={vi.fn()}
    />,
  );
  return { onBackup };
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
    expect(onBackup).toHaveBeenCalledWith(false);
  });

  it("asks to check a backup file that was never opened, or to make a new one", () => {
    const { onBackup } = renderOverview({
      publicIdentity: PUBLIC_IDENTITY,
      backup: { createdAt: BACKUP_AT },
    });

    const reminder = screen.getByText(/but it was never checked/u).closest("[data-tone]");
    expect(reminder).toHaveAttribute("data-tone", "warning");
    expect(reminder).toHaveTextContent(
      `Passport made a recovery file on ${formatBackupDate(new Date(BACKUP_AT))}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Check recovery file" }));
    expect(onBackup).toHaveBeenLastCalledWith(true);
    // The download may never have been saved, so a new file is one tap away too.
    fireEvent.click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(onBackup).toHaveBeenLastCalledWith(false);
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
