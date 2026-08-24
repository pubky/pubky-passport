/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../../libs/logger/logger";
import type { LocalIdentityMetadata } from "../../../logic/local-identity/localIdentityModels";
import { IdentityManagement } from "./identityManagement";

const MOCKS = vi.hoisted(() => ({ showCopyConfirmation: vi.fn() }));

vi.mock("../../shared/sonner", () => ({ showCopyConfirmation: MOCKS.showCopyConfirmation }));

const identity = {
  googleAccount: { email: "satoshi@gmail.com", name: "Satoshi Nakamoto" },
  publicIdentity: { publicKeyZ32: "x8jpihgjy51fdnaingcp8rum1omfzd6p8bhm7usune41grd97dho5cwy4mra" },
} as LocalIdentityMetadata;

describe("IdentityManagement", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("copies the Pubky and resolved PKDNS homeserver and returns", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const onBack = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<IdentityManagement identity={identity} onBack={onBack} onDetachFromGoogle={vi.fn()} onDownloadRecoveryFile={vi.fn()} onRemoveLocalIdentity={vi.fn()} onMigrateToKeychain={vi.fn()} resolveHomeserver={async () => Result.ok("homeserver-pubky")} />);
    const back = screen.getByRole("button", { name: "Back" });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
    const copyButton = screen.getByRole("button", { name: "Copy Pubky" });
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(identity.publicIdentity.publicKeyZ32));
    expect(MOCKS.showCopyConfirmation).toHaveBeenCalledWith("Pubky", identity.publicIdentity.publicKeyZ32);
    const homeserverButton = screen.getByRole("button", { name: "Copy Homeserver" });
    await waitFor(() => expect(homeserverButton).toBeEnabled());
    fireEvent.click(homeserverButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("homeserver-pubky"));
    expect(MOCKS.showCopyConfirmation).toHaveBeenCalledWith("Homeserver", "homeserver-pubky");
  });

  it("does not confirm a failed copy", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(() => Promise.reject(new Error("SECRET-COPY-CANARY"))) } });
    render(<IdentityManagement identity={identity} onBack={vi.fn()} onDetachFromGoogle={vi.fn()} onDownloadRecoveryFile={vi.fn()} onRemoveLocalIdentity={vi.fn()} onMigrateToKeychain={vi.fn()} resolveHomeserver={async () => Result.ok("homeserver-pubky")} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Pubky" }));

    await waitFor(() => expect(MOCKS.showCopyConfirmation).not.toHaveBeenCalled());
    expect(info).toHaveBeenCalledWith("identity.management.failed", {
      operation: "copy",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("SECRET-COPY-CANARY");
  });

  it("settles a rejected homeserver lookup as unavailable", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    render(<IdentityManagement identity={identity} onBack={vi.fn()} onDetachFromGoogle={vi.fn()} onDownloadRecoveryFile={vi.fn()} onRemoveLocalIdentity={vi.fn()} onMigrateToKeychain={vi.fn()} resolveHomeserver={async () => { throw new Error("SECRET-HOMESERVER-CANARY"); }} />);

    await waitFor(() => expect(screen.getByText("Unavailable")).toBeInTheDocument());
    expect(warning).toHaveBeenCalledWith("identity.management.failed", {
      operation: "resolve_homeserver",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-HOMESERVER-CANARY");
  });
});
