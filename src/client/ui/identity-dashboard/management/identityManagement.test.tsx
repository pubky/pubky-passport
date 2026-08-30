/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../../libs/logger/logger";
import type { LocalIdentityMetadata } from "../../../logic/local-identity/localIdentityModels";
import { IdentityManagement } from "./identityManagement";

const MOCKS = vi.hoisted(() => ({
  showHomeserverCopied: vi.fn(),
  showPubkyCopied: vi.fn(),
}));

vi.mock("../../shared/feedbackNotifications", () => ({
  showHomeserverCopied: MOCKS.showHomeserverCopied,
  showPubkyCopied: MOCKS.showPubkyCopied,
}));

const identity = {
  googleAccount: {
    email: "satoshi@gmail.com",
    googleSubject: "google-subject",
    name: "Satoshi Nakamoto",
    pictureUrl: null,
  },
  publicIdentity: { publicKeyZ32: "x8jpihgjy51fdnaingcp8rum1omfzd6p8bhm7usune41grd97dho5cwy4mra" },
} satisfies LocalIdentityMetadata;

describe("IdentityManagement", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("copies the Pubky and resolved PKDNS homeserver and returns", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const onBack = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(
      <IdentityManagement
        identity={identity}
        onBack={onBack}
        onDetachFromGoogle={vi.fn()}
        onDownloadRecoveryFile={vi.fn()}
        onRemoveLocalIdentity={() => Result.ok()}
        onMigrateToKeychain={vi.fn()}
        resolveHomeserver={async () => Result.ok("homeserver-pubky")}
      />,
    );
    const back = screen.getByRole("button", { name: "Back" });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
    const copyButton = screen.getByRole("button", { name: "Copy Pubky" });
    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(identity.publicIdentity.publicKeyZ32),
    );
    expect(MOCKS.showPubkyCopied).toHaveBeenCalledWith(identity.publicIdentity.publicKeyZ32);
    const homeserverButton = screen.getByRole("button", { name: "Copy Homeserver" });
    await waitFor(() => expect(homeserverButton).toBeEnabled());
    fireEvent.click(homeserverButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("homeserver-pubky"));
    expect(MOCKS.showHomeserverCopied).toHaveBeenCalledOnce();
  });

  it("does not confirm a failed copy", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.reject(new Error("SECRET-COPY-CANARY"))) },
    });
    render(
      <IdentityManagement
        identity={identity}
        onBack={vi.fn()}
        onDetachFromGoogle={vi.fn()}
        onDownloadRecoveryFile={vi.fn()}
        onRemoveLocalIdentity={() => Result.ok()}
        onMigrateToKeychain={vi.fn()}
        resolveHomeserver={async () => Result.ok("homeserver-pubky")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy Pubky" }));

    await waitFor(() => {
      expect(MOCKS.showPubkyCopied).not.toHaveBeenCalled();
      expect(MOCKS.showHomeserverCopied).not.toHaveBeenCalled();
    });
    expect(info).toHaveBeenCalledWith(
      "identity.management.failed",
      expect.objectContaining({
        operation: "copy",
        diagnosticId: expect.any(String),
        errorName: "Error",
      }),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("SECRET-COPY-CANARY");
  });

  it("settles a rejected homeserver lookup as unavailable", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    render(
      <IdentityManagement
        identity={identity}
        onBack={vi.fn()}
        onDetachFromGoogle={vi.fn()}
        onDownloadRecoveryFile={vi.fn()}
        onRemoveLocalIdentity={() => Result.ok()}
        onMigrateToKeychain={vi.fn()}
        resolveHomeserver={async () => {
          throw new Error("SECRET-HOMESERVER-CANARY");
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("Unavailable")).toBeInTheDocument());
    expect(warning).toHaveBeenCalledWith(
      "identity.management.failed",
      expect.objectContaining({
        operation: "resolve_homeserver",
        diagnosticId: expect.any(String),
        errorName: "Error",
      }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-HOMESERVER-CANARY");
  });

  it("shows a retryable error when local logout fails", () => {
    const onBack = vi.fn();
    render(
      <IdentityManagement
        identity={identity}
        onBack={onBack}
        onDetachFromGoogle={vi.fn()}
        onDownloadRecoveryFile={vi.fn()}
        onRemoveLocalIdentity={() => Result.err({ code: "storage_unavailable" })}
        onMigrateToKeychain={vi.fn()}
        resolveHomeserver={async () => Result.ok(null)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(screen.getByText("Could not log out. Please try again.")).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("shows destructive logout above Back on mobile and on the right on desktop", () => {
    render(
      <IdentityManagement
        identity={identity}
        onBack={vi.fn()}
        onDetachFromGoogle={vi.fn()}
        onDownloadRecoveryFile={vi.fn()}
        onRemoveLocalIdentity={() => Result.ok()}
        onMigrateToKeychain={vi.fn()}
        resolveHomeserver={async () => Result.ok(null)}
      />,
    );

    const logout = screen.getByRole("button", { name: "Log out" });
    const back = screen.getByRole("button", { name: "Back" });
    const navigation = logout.parentElement?.parentElement;

    expect(logout).toHaveClass("bg-destructive-surface", "text-destructive-foreground", "h-[60px]");
    expect(logout.querySelector("svg")).toBeInTheDocument();
    expect(logout.parentElement).toHaveClass("md:col-start-3", "md:row-start-1");
    expect(back.parentElement).toHaveClass("md:col-start-1", "md:row-start-1");
    expect(Array.from(navigation?.querySelectorAll("button") ?? [])).toEqual([logout, back]);
  });
});
