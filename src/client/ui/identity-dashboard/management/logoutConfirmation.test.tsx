/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
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
const UNLOCKED_REMOVAL_TEXT =
  "This removes the private key from Passport in this browser. Copies can remain in the browser's files and in backups until they are overwritten. Your public profile remains online, and sessions in other apps stay signed in.";

describe("LogoutConfirmation", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("requires a backup acknowledgement before removing an unbacked browser key", () => {
    const onRemoveIdentity = vi.fn(() => Result.ok());
    const onRemoved = vi.fn();
    const onDownloadBackup = vi.fn();
    renderConfirmation({
      identity: { publicIdentity: PUBLIC_IDENTITY },
      onDownloadBackup,
      onRemoveIdentity,
      onRemoved,
    });

    expect(screen.getByText(UNLOCKED_REMOVAL_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No Google backup is attached");
    expect(screen.getByRole("button", { name: "Log out" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
    expect(onDownloadBackup).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I have a backup of this identity and understand the key will be removed from Passport in this browser.",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onRemoveIdentity).toHaveBeenCalledOnce();
    expect(onRemoved).toHaveBeenCalledOnce();
  });

  it("does not gate logout for a Google-backed identity", () => {
    renderConfirmation({
      identity: { publicIdentity: PUBLIC_IDENTITY, googleAccount: GOOGLE_ACCOUNT },
    });

    expect(screen.getByText(UNLOCKED_REMOVAL_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download backup" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled();
  });

  it("only removes the saved reference to a Ring-held identity", () => {
    renderConfirmation({ identity: { publicIdentity: PUBLIC_IDENTITY, keySource: "ring" } });

    expect(screen.getByText(/removes the saved identity from this browser/)).toBeInTheDocument();
    expect(screen.queryByText(/removes the private key/)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled();
  });

  it("names the identity by its profile, never by the attached Google account", () => {
    renderConfirmation({
      identity: { publicIdentity: PUBLIC_IDENTITY, googleAccount: GOOGLE_ACCOUNT },
    });
    expect(screen.getByText("Your Pubky")).toBeInTheDocument();
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

    expect(screen.getByRole("alert")).toHaveTextContent("Could not log out. Please try again.");
    expect(onRemoved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

function renderConfirmation({
  identity,
  onCancel = vi.fn(),
  onDownloadBackup = vi.fn(),
  onRemoveIdentity = () => Result.ok(),
  onRemoved = vi.fn(),
}: {
  identity: LocalIdentityMetadata;
  onCancel?: () => void;
  onDownloadBackup?: () => void;
  onRemoveIdentity?: () => LocalIdentityResult<void>;
  onRemoved?: () => void;
}) {
  return render(
    <LogoutConfirmation
      identity={identity}
      onCancel={onCancel}
      onDownloadBackup={onDownloadBackup}
      onRemoveIdentity={onRemoveIdentity}
      onRemoved={onRemoved}
    />,
  );
}
