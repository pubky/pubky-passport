/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import type {
  LocalIdentityAuthorizedAppsResult,
  LocalIdentityHomeserverRepublishResult,
} from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { PubkyHomeserverResolutionResult } from "@/client/logic/pubky/pubkyIdentityKey";
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

  it("keeps the homeserver copy control disabled until a PKDNS name resolves", async () => {
    let settleLookup!: (value: string) => void;
    render(
      <IdentityManagement
        identity={identity}
        listAuthorizedApps={async () => Result.ok([])}
        onBack={vi.fn()}
        onDetachFromProvider={vi.fn()}
        onDownloadRecoveryFile={vi.fn()}
        onRemoveLocalIdentity={() => Result.ok()}
        onMigrateToKeychain={vi.fn()}
        republishHomeserver={async () => Result.ok()}
        resolveHomeserver={() =>
          new Promise((resolve) => {
            settleLookup = (pubky) => resolve(Result.ok(pubky));
          })
        }
        revokeAuthorizedApp={async () => Result.ok()}
      />,
    );

    const homeserverButton = screen.getByRole("button", { name: "Copy Homeserver" });
    expect(screen.getByText("Looking up…")).toBeInTheDocument();
    expect(homeserverButton).toBeDisabled();

    settleLookup("homeserver-pubky");
    await waitFor(() => expect(homeserverButton).toBeEnabled());
    expect(screen.getByText("homeserver-pubky")).toBeInTheDocument();
  });

  it("copies the Pubky and resolved PKDNS homeserver and returns", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const onBack = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    renderManagement({ onBack, resolveHomeserver: async () => Result.ok("homeserver-pubky") });
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
    expect(screen.queryByRole("button", { name: "Republish homeserver" })).not.toBeInTheDocument();
  });

  it("does not confirm a failed copy", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.reject(new Error("SECRET-COPY-CANARY"))) },
    });
    renderManagement({ resolveHomeserver: async () => Result.ok("homeserver-pubky") });

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
    renderManagement({
      resolveHomeserver: async () => {
        throw new Error("SECRET-HOMESERVER-CANARY");
      },
    });

    await waitFor(() => expect(screen.getByText("Unavailable")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Copy Homeserver" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Republish homeserver" })).toBeInTheDocument();
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

  it("shows a visible result after a successful manual republish", async () => {
    const republishHomeserver = vi.fn(async () => Result.ok());
    const resolveHomeserver = vi
      .fn(async (): Promise<PubkyHomeserverResolutionResult> => Result.ok(null))
      .mockResolvedValueOnce(Result.ok(null))
      .mockResolvedValueOnce(Result.ok("homeserver-pubky"));

    renderManagement({ republishHomeserver, resolveHomeserver });

    await waitFor(() => expect(screen.getByText("Unavailable")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Republish homeserver" }));

    await waitFor(() =>
      expect(screen.getByText("Homeserver record republished.")).toBeInTheDocument(),
    );
    expect(republishHomeserver).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy Homeserver" })).toBeEnabled(),
    );
    expect(screen.queryByRole("button", { name: "Republish homeserver" })).not.toBeInTheDocument();
  });

  it("shows a retryable error when manual republish fails", async () => {
    renderManagement({
      republishHomeserver: async () => Result.err({ code: "publication_failed" }),
      resolveHomeserver: async () => Result.ok(null),
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Republish homeserver" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Republish homeserver" }));

    await waitFor(() =>
      expect(
        screen.getByText("Could not republish the homeserver record. Please try again."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Republish homeserver" })).toBeEnabled();
  });

  it("shows a retryable error when local logout fails", () => {
    const onBack = vi.fn();
    renderManagement({
      onBack,
      onRemoveLocalIdentity: () => Result.err({ code: "storage_unavailable" }),
      resolveHomeserver: async () => Result.ok(null),
    });

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(screen.getByText("Could not log out. Please try again.")).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("groups backup and keychain before logout and Google detachment", async () => {
    const onBack = vi.fn();
    const onDownloadRecoveryFile = vi.fn();
    const onMigrateToKeychain = vi.fn();
    const onDetachFromProvider = vi.fn();
    const onRemoveLocalIdentity = vi.fn(() => Result.ok());
    renderManagement({
      onBack,
      onDetachFromProvider,
      onDownloadRecoveryFile,
      onMigrateToKeychain,
      onRemoveLocalIdentity,
    });

    const backup = screen.getByRole("button", { name: "Backup" });
    const keychain = screen.getByRole("button", { name: "Keychain" });
    const logout = screen.getByRole("button", { name: "Log out" });
    const detach = screen.getByRole("button", { name: "Detach from Google" });
    const back = screen.getByRole("button", { name: "Back" });

    expect(backup.parentElement).toBe(keychain.parentElement);
    expect(backup.parentElement).toHaveClass("grid", "grid-cols-2");
    expect(backup.parentElement?.parentElement).toBe(logout.parentElement);
    expect(logout.parentElement).toBe(detach.parentElement);
    expect(logout).not.toHaveClass("absolute");
    expect(
      backup.compareDocumentPosition(keychain) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      keychain.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(logout.compareDocumentPosition(detach) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(detach.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(backup);
    fireEvent.click(keychain);
    fireEvent.click(detach);
    expect(onDownloadRecoveryFile).toHaveBeenCalledOnce();
    expect(onMigrateToKeychain).toHaveBeenCalledOnce();
    expect(onDetachFromProvider).toHaveBeenCalledOnce();
    expect(onRemoveLocalIdentity).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();

    fireEvent.click(logout);
    expect(onRemoveLocalIdentity).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText("homeserver-pubky")).toBeInTheDocument());
  });

  it("lists authorized apps below the identity actions", async () => {
    const listAuthorizedApps = vi.fn(async () =>
      Result.ok([
        {
          grantId: "grant-1",
          clientId: "demo.pubky.app",
          capabilities: ["/pub/demo.pubky.app/:rw"],
          issuedAt: 1_767_225_600,
          expiresAt: 0,
        },
      ]),
    );
    renderManagement({ listAuthorizedApps });

    const app = await screen.findByRole("button", { name: /demo\.pubky\.app/ });
    const logout = screen.getByRole("button", { name: "Log out" });
    expect(logout.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Authorized apps" })).toBeInTheDocument();
    expect(listAuthorizedApps).toHaveBeenCalledOnce();
  });

  it("keeps backup, keychain and logout available for an identity detached from Google", async () => {
    renderManagement({ identity: { publicIdentity: identity.publicIdentity } });

    expect(screen.getByText("Sign-in account")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("Google account")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keychain" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Detach from Google" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("homeserver-pubky")).toBeInTheDocument());
  });

  it("names the Apple Account and detaches from Apple for an Apple identity", async () => {
    const onDetachFromProvider = vi.fn();
    const appleAccount = { appleSubject: "001234.abcdef.1234", email: null, name: null };
    const appleIdentity = {
      appleAccount,
      publicIdentity: identity.publicIdentity,
    } satisfies LocalIdentityMetadata;
    renderManagement({ identity: appleIdentity, onDetachFromProvider });

    expect(screen.getByText("Apple Account")).toBeInTheDocument();
    expect(screen.getByText("Key stored in iCloud")).toBeInTheDocument();
    expect(screen.queryByText("Google account")).not.toBeInTheDocument();
    expect(screen.queryByText("001234.abcdef.1234")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Detach from Apple" }));
    expect(onDetachFromProvider).toHaveBeenCalledWith({ provider: "apple", appleAccount });
    await waitFor(() => expect(screen.getByText("homeserver-pubky")).toBeInTheDocument());
  });

  it("shows the Apple name and email kept in this browser", async () => {
    renderManagement({
      identity: {
        appleAccount: {
          appleSubject: "001234.abcdef.1234",
          email: "abc123@privaterelay.appleid.com",
          name: "Jane Appleseed",
        },
        publicIdentity: identity.publicIdentity,
      },
    });

    expect(screen.getByText("Jane Appleseed")).toBeInTheDocument();
    expect(screen.getByText("abc123@privaterelay.appleid.com")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("homeserver-pubky")).toBeInTheDocument());
  });
});

function renderManagement({
  identity: managedIdentity = identity,
  listAuthorizedApps = async () => Result.ok([]),
  onBack = vi.fn(),
  onDetachFromProvider = vi.fn(),
  onDownloadRecoveryFile = vi.fn(),
  onMigrateToKeychain = vi.fn(),
  onRemoveLocalIdentity = () => Result.ok(),
  republishHomeserver = async () => Result.ok(),
  resolveHomeserver = async () => Result.ok("homeserver-pubky"),
}: {
  identity?: LocalIdentityMetadata;
  listAuthorizedApps?: () => Promise<LocalIdentityAuthorizedAppsResult>;
  onBack?: () => void;
  onDetachFromProvider?: (account: unknown) => void;
  onDownloadRecoveryFile?: () => void;
  onMigrateToKeychain?: () => void;
  onRemoveLocalIdentity?: () => LocalIdentityResult<void>;
  republishHomeserver?: () => Promise<LocalIdentityHomeserverRepublishResult>;
  resolveHomeserver?: () => Promise<PubkyHomeserverResolutionResult>;
} = {}) {
  return render(
    <IdentityManagement
      identity={managedIdentity}
      listAuthorizedApps={listAuthorizedApps}
      onBack={onBack}
      onDetachFromProvider={onDetachFromProvider}
      onDownloadRecoveryFile={onDownloadRecoveryFile}
      onRemoveLocalIdentity={onRemoveLocalIdentity}
      onMigrateToKeychain={onMigrateToKeychain}
      republishHomeserver={republishHomeserver}
      resolveHomeserver={resolveHomeserver}
      revokeAuthorizedApp={async () => Result.ok()}
    />,
  );
}
