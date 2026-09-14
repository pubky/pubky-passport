/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { IdentityManagement } from "./identityManagement";

const MOCKS = vi.hoisted(() => ({ toastInfo: vi.fn() }));

vi.mock("sonner", () => ({ toast: { info: MOCKS.toastInfo } }));

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
    expect(MOCKS.toastInfo).toHaveBeenCalledWith("Pubky copied to clipboard", {
      description: `${identity.publicIdentity.publicKeyZ32.slice(0, 32)}...`,
    });
    const homeserverButton = screen.getByRole("button", { name: "Copy Homeserver" });
    await waitFor(() => expect(homeserverButton).toBeEnabled());
    fireEvent.click(homeserverButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("homeserver-pubky"));
    expect(MOCKS.toastInfo).toHaveBeenCalledWith("Homeserver copied");
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
      expect(MOCKS.toastInfo).not.toHaveBeenCalled();
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

  it("shows secondary logout in the header at the responsive design sizes", () => {
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

    expect(logout).toHaveClass(
      "absolute",
      "right-6",
      "top-[26px]",
      "md:right-10",
      "md:top-12",
      "bg-secondary",
      "h-8",
      "md:h-10",
    );
    expect(logout.querySelector("svg")).toBeInTheDocument();
    expect(logout).not.toHaveClass("bg-destructive-surface", "h-[60px]");
    expect(back.parentElement?.parentElement).toHaveClass("grid", "md:grid-cols-[120px_1fr_228px]");
  });
});
