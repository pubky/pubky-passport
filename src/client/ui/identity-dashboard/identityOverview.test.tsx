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

    // The status line only says where the key is; the notice alone carries the warning.
    expect(screen.getByText("Key in this browser")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-tone="warning"]')).toHaveLength(1);
    const reminder = screen
      .getByText(/This key is saved only in this browser/u)
      .closest("[data-tone]");
    expect(reminder).toHaveAttribute("data-tone", "warning");
    expect(screen.queryByRole("button", { name: "Check backup" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
    expect(onBackup).toHaveBeenCalledWith(false);
  });

  it("asks to check a backup file that was never opened, or to make a new one", () => {
    const { onBackup } = renderOverview({
      publicIdentity: PUBLIC_IDENTITY,
      backup: { createdAt: BACKUP_AT },
    });

    expect(screen.getByText("Key in this browser")).toBeInTheDocument();
    const reminder = screen.getByText(/but it was never checked/u).closest("[data-tone]");
    expect(reminder).toHaveAttribute("data-tone", "warning");
    expect(reminder).toHaveTextContent(
      `Passport made a backup file on ${formatBackupDate(new Date(BACKUP_AT))}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Check backup" }));
    expect(onBackup).toHaveBeenLastCalledWith(true);
    // The download may never have been saved, so a new file is one tap away too.
    fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
    expect(onBackup).toHaveBeenLastCalledWith(false);
  });

  it.each([
    [
      "a checked backup file",
      { backup: { verifiedAt: BACKUP_AT } },
      `Key in this browser, backup checked ${formatBackupDate(new Date(BACKUP_AT))}`,
    ],
    [
      "a Google Drive copy",
      {
        googleAccount: {
          googleSubject: "subject",
          email: "person@example.com",
          name: "Person",
          pictureUrl: null,
        },
      },
      "Key in this browser, backed up to Google Drive",
    ],
    ["Pubky Ring", { keySource: "ring" } as const, "Key in Pubky Ring"],
  ])("only states where the key is when %s protects it", (_, protection, line) => {
    renderOverview({ publicIdentity: PUBLIC_IDENTITY, ...protection });

    expect(screen.getByText(line)).toBeInTheDocument();
    expect(document.querySelector('[data-tone="warning"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Download backup" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check backup" })).not.toBeInTheDocument();
  });
});
