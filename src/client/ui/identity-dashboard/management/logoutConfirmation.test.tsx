/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import { LogoutConfirmation } from "./logoutConfirmation";

const PUBLIC_IDENTITY = {
  publicKeyZ32: "x8jpihgjy51fdnaingcp8rum1omfzd6p8bhm7usune41grd97dho5cwy4mra",
};
const GOOGLE_ACCOUNT = {
  email: "satoshi@gmail.com",
  googleSubject: "google-subject",
  name: "Satoshi Google",
  pictureUrl: null,
};
const BACKUP_AT = "2026-09-01T10:00:00.000Z";
const BACKUP_DATE = formatBackupDate(new Date(BACKUP_AT));

describe("LogoutConfirmation", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("calls deleting an unbacked browser key a removal, with the backup in the warning", () => {
    const onRemoveIdentity = vi.fn(() => Result.ok());
    const onRemoved = vi.fn();
    const onDownloadBackup = vi.fn();
    renderConfirmation({
      identity: { publicIdentity: PUBLIC_IDENTITY },
      onDownloadBackup,
      onRemoveIdentity,
      onRemoved,
    });

    expect(
      screen.getByRole("heading", { name: "Remove this key from this browser?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/deletes the private key saved in this browser/)).toBeInTheDocument();
    const warning = screen.getByText(/Passport has no backup of this key/u).closest("[data-tone]");
    expect(warning).toHaveAttribute("data-tone", "warning");
    expect(warning).toHaveTextContent("this pubky is gone for good");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove key" })).toBeDisabled();

    const download = screen.getByRole("button", { name: "Download backup" });
    expect(warning).toContainElement(download);
    fireEvent.click(download);
    expect(onDownloadBackup).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    expect(onRemoveIdentity).toHaveBeenCalledOnce();
    expect(onRemoved).toHaveBeenCalledOnce();
  });

  it("keeps a key whose backup file was never checked a removal, with check and download", () => {
    const onCheckBackup = vi.fn();
    const onDownloadBackup = vi.fn();
    renderConfirmation({
      identity: { publicIdentity: PUBLIC_IDENTITY, backup: { createdAt: BACKUP_AT } },
      onCheckBackup,
      onDownloadBackup,
    });

    // The browser may never have saved the file Passport made, so this may be the only copy.
    expect(
      screen.getByRole("heading", { name: "Remove this key from this browser?" }),
    ).toBeInTheDocument();
    const warning = screen.getByText(/but it was never checked/u).closest("[data-tone]");
    expect(warning).toHaveAttribute("data-tone", "warning");
    expect(warning).toHaveTextContent(`Passport made a backup file on ${BACKUP_DATE}`);
    expect(warning).not.toHaveTextContent("You created");
    const check = screen.getByRole("button", { name: "Check backup" });
    const download = screen.getByRole("button", { name: "Download backup" });
    expect(warning).toContainElement(check);
    expect(warning).toContainElement(download);
    expect(check).toHaveClass("bg-brand/16");
    expect(download).not.toHaveClass("bg-brand/16");
    fireEvent.click(check);
    expect(onCheckBackup).toHaveBeenCalledOnce();
    fireEvent.click(download);
    expect(onDownloadBackup).toHaveBeenCalledOnce();

    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove key" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I have a backup of this key and understand it will be deleted from this browser.",
      }),
    );
    expect(screen.getByRole("button", { name: "Remove key" })).toBeEnabled();
  });

  it("reminds of a checked backup file without warning", () => {
    renderConfirmation({
      identity: {
        publicIdentity: PUBLIC_IDENTITY,
        // A newer file that was never checked does not undo an earlier check.
        backup: { createdAt: "2026-09-02T10:00:00.000Z", verifiedAt: BACKUP_AT },
      },
    });

    expect(screen.getByRole("heading", { name: "Log out of this identity?" })).toBeInTheDocument();
    expect(
      screen.getByText(`You checked a backup file of this key on ${BACKUP_DATE}.`, {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-tone="warning"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Check backup" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled();
  });

  it("does not gate logout for a Google-backed identity and says how to come back", () => {
    renderConfirmation({
      identity: { publicIdentity: PUBLIC_IDENTITY, googleAccount: GOOGLE_ACCOUNT },
    });

    expect(
      screen.getByText(/choose Continue with Google and sign in as/u, { exact: false }),
    ).toHaveTextContent(`sign in as ${GOOGLE_ACCOUNT.email}.`);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download backup" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled();
  });

  it("only removes the saved reference to a Ring-held identity", () => {
    renderConfirmation({ identity: { publicIdentity: PUBLIC_IDENTITY, keySource: "ring" } });

    expect(screen.getByText(/removes the saved identity from this browser/)).toHaveTextContent(
      "Your key stays in Pubky Ring",
    );
    expect(screen.queryByText(/deletes the private key/)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled();
    // Where the key lives, in the tag the lists and the review use.
    expect(screen.getByText("Key in Pubky Ring")).toBeInTheDocument();
  });

  it("names the identity by its profile, never by the attached Google account", () => {
    renderConfirmation({
      identity: { publicIdentity: PUBLIC_IDENTITY, googleAccount: GOOGLE_ACCOUNT },
    });
    expect(screen.getByText("Pubky x8jp…4mra")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: `Attached Google account: ${GOOGLE_ACCOUNT.email}` }),
    ).toBeInTheDocument();
    expect(screen.getByText(PUBLIC_IDENTITY.publicKeyZ32)).toBeInTheDocument();
    expect(screen.queryByText("Satoshi Google")).not.toBeInTheDocument();

    cleanup();
    renderConfirmation({
      identity: {
        publicIdentity: PUBLIC_IDENTITY,
        googleAccount: GOOGLE_ACCOUNT,
        profile: { name: "Satoshi" },
      },
    });
    expect(screen.getByText("Satoshi")).toBeInTheDocument();
  });

  it("shows a retryable error when removal fails and stays on the screen", () => {
    const onRemoved = vi.fn();
    const onCancel = vi.fn();
    renderConfirmation({
      identity: { publicIdentity: PUBLIC_IDENTITY, googleAccount: GOOGLE_ACCOUNT },
      onCancel,
      onRemoveIdentity: () => Result.err({ code: "storage_unavailable" }),
      onRemoved,
    });

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not log out. Nothing was deleted. Please try again.",
    );
    expect(onRemoved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

function renderConfirmation({
  identity,
  onCancel = vi.fn(),
  onCheckBackup = vi.fn(),
  onDownloadBackup = vi.fn(),
  onRemoveIdentity = () => Result.ok(),
  onRemoved = vi.fn(),
}: {
  identity: LocalIdentityMetadata;
  onCancel?: () => void;
  onCheckBackup?: () => void;
  onDownloadBackup?: () => void;
  onRemoveIdentity?: () => LocalIdentityResult<void>;
  onRemoved?: () => void;
}) {
  return render(
    <LogoutConfirmation
      identity={identity}
      onCancel={onCancel}
      onCheckBackup={onCheckBackup}
      onDownloadBackup={onDownloadBackup}
      onRemoveIdentity={onRemoveIdentity}
      onRemoved={onRemoved}
    />,
  );
}
