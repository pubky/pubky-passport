/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render as renderView,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Result } from "better-result";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityHomeserverRepublishResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { PubkyHomeserverResolutionResult } from "@/client/logic/pubky/pubkyIdentityKey";
import { formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import { PassportProviderConfiguration } from "@/client/ui/passportProviderConfiguration";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { IdentityManagement } from "./identityManagement";

const MOCKS = vi.hoisted(() => ({ toastInfo: vi.fn() }));

vi.mock("sonner", () => ({ toast: { info: MOCKS.toastInfo } }));

const PROVIDER_HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";
const REGISTERED_HOMESERVER = "8um71us3fyw6h8wbcxb5ar3rwusy1a6u49956ikzojg3gcwd1dty";

const identity = {
  googleAccount: {
    email: "satoshi@gmail.com",
    googleSubject: "google-subject",
    name: "Satoshi Nakamoto",
    pictureUrl: null,
  },
  publicIdentity: { publicKeyZ32: "x8jpihgjy51fdnaingcp8rum1omfzd6p8bhm7usune41grd97dho5cwy4mra" },
} satisfies LocalIdentityMetadata;
const browserOnlyIdentity = {
  publicIdentity: identity.publicIdentity,
} satisfies LocalIdentityMetadata;
const BACKUP_AT = "2026-09-01T10:00:00.000Z";
const BACKUP_DATE = formatBackupDate(new Date(BACKUP_AT));
const ringIdentity = {
  publicIdentity: identity.publicIdentity,
  keySource: "ring",
} satisfies LocalIdentityMetadata;

function render(view: ReactNode) {
  return renderView(
    <PassportProviderConfiguration value={makeInstanceConfig()}>
      {view}
    </PassportProviderConfiguration>,
  );
}

describe("IdentityManagement", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("copies the Pubky and returns", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const onBack = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderManagement({ onBack });

    fireEvent.click(screen.getByRole("button", { name: "Copy Pubky" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(identity.publicIdentity.publicKeyZ32),
    );
    expect(MOCKS.toastInfo).toHaveBeenCalledWith("Pubky copied to clipboard", {
      description: `${identity.publicIdentity.publicKeyZ32.slice(0, 32)}...`,
    });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("names the identity by its profile and never by the attached Google account", () => {
    renderManagement();

    const profile = screen.getByRole("region", { name: "Public profile" });
    // Without a profile it is named after its own key, never with a shared placeholder.
    expect(profile).toHaveTextContent("Pubky x8jp…4mra");
    expect(profile).not.toHaveTextContent("Your Pubky");
    expect(profile).not.toHaveTextContent("Satoshi Nakamoto");
    // No initials of a placeholder or of the Google name: a person glyph on the key's colour.
    expect(profile.querySelector("[data-unnamed]")).not.toBeNull();
    expect(within(profile).queryByText("PU")).not.toBeInTheDocument();
    expect(within(profile).queryByText("SA")).not.toBeInTheDocument();
  });

  it("says where the key lives under the name, as every identity list does", () => {
    renderManagement({ identity: browserOnlyIdentity });
    expect(
      within(screen.getByRole("region", { name: "Public profile" })).getByText(
        "Key in this browser",
      ),
    ).toBeVisible();
    cleanup();

    renderManagement();
    expect(
      within(screen.getByRole("region", { name: "Public profile" })).getByRole("group", {
        name: "Attached Google account: satoshi@gmail.com",
      }),
    ).toBeVisible();
  });

  it("republishes a browser key's missing record to the provider homeserver", async () => {
    const republishHomeserver = vi.fn(async () => Result.ok(PROVIDER_HOMESERVER));
    renderManagement({ republishHomeserver, resolveHomeserver: async () => Result.ok(null) });

    fireEvent.click(await screen.findByRole("button", { name: "Republish homeserver" }));
    fireEvent.click(screen.getByRole("button", { name: /Yes, publish record/u }));

    await waitFor(() =>
      expect(republishHomeserver).toHaveBeenCalledWith(
        identity.publicIdentity.publicKeyZ32,
        PROVIDER_HOMESERVER,
      ),
    );
  });

  it("never offers the provider homeserver to an identity signed up elsewhere", async () => {
    const republishHomeserver = vi.fn(async () => Result.ok(REGISTERED_HOMESERVER));
    renderManagement({
      identity: { ...browserOnlyIdentity, homeserverPubky: REGISTERED_HOMESERVER },
      republishHomeserver,
      resolveHomeserver: async () => Result.ok(null),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Republish homeserver" }));
    const confirmation = screen.getByRole("region", {
      name: "Point this pubky back at its homeserver?",
    });
    expect(confirmation).toHaveTextContent(REGISTERED_HOMESERVER);
    expect(confirmation).not.toHaveTextContent(PROVIDER_HOMESERVER);
    fireEvent.click(screen.getByRole("button", { name: "Publish record" }));

    await waitFor(() =>
      expect(republishHomeserver).toHaveBeenCalledExactlyOnceWith(
        identity.publicIdentity.publicKeyZ32,
        REGISTERED_HOMESERVER,
      ),
    );
  });

  it("groups recovery and account actions in management", () => {
    renderManagement();

    expect(screen.getByRole("region", { name: "Backup & key access" })).toContainElement(
      screen.getByRole("button", { name: "Download recovery file" }),
    );
    expect(screen.getByRole("region", { name: "Google account" })).toContainElement(
      screen.getByRole("button", { name: "Detach from Google" }),
    );
    expect(screen.getByRole("region", { name: "Backup & key access" })).toContainElement(
      screen.getByRole("region", { name: "Google account" }),
    );
    expect(screen.getByRole("region", { name: "Google account" })).not.toContainElement(
      screen.getByRole("button", { name: "Download recovery file" }),
    );
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Public profile" })).toContainElement(
      screen.getByRole("group", { name: "Homeserver" }),
    );
  });

  it("offers Google attachment in its own section within the backup card", () => {
    const onBackupToGoogle = vi.fn();
    renderManagement({ identity: browserOnlyIdentity, onBackupToGoogle });

    const attach = screen.getByRole("button", { name: "Attach to Google" });
    expect(screen.getByRole("region", { name: "Google account" })).toContainElement(attach);
    fireEvent.click(attach);
    expect(onBackupToGoogle).toHaveBeenCalledOnce();
  });

  it("does not offer Google attachment when the caller provides no way to attach", () => {
    renderManagement({ identity: browserOnlyIdentity });

    expect(screen.queryByRole("region", { name: "Google account" })).not.toBeInTheDocument();
  });

  it("offers no key actions for an identity held in Pubky Ring", async () => {
    renderManagement({
      identity: ringIdentity,
      onBackupToGoogle: vi.fn(),
      resolveHomeserver: async () => Result.ok(null),
    });

    expect(await screen.findByText("No record found")).toBeInTheDocument();
    expect(screen.getByText(/private key stays in Pubky Ring/)).toBeInTheDocument();
    for (const name of [
      "Download recovery file",
      "Use in Pubky Ring",
      "Republish homeserver",
      "Attach to Google",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(screen.getByText(/removes the saved identity from this browser/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("downloads a backup and returns to the screen it was requested from", () => {
    const onDownloadRecoveryFile = vi.fn();
    renderManagement({ identity: browserOnlyIdentity, onDownloadRecoveryFile });

    fireEvent.click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(onDownloadRecoveryFile).toHaveBeenLastCalledWith("manage");

    fireEvent.click(screen.getByRole("button", { name: "Remove key from this browser" }));
    fireEvent.click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(onDownloadRecoveryFile).toHaveBeenLastCalledWith("logout");
  });

  it("says a browser key has no backup and makes removing it, not logging out, the action", () => {
    renderManagement({ identity: browserOnlyIdentity });

    const card = screen.getByRole("region", { name: "Backup & key access" });
    expect(card).toHaveTextContent("Your key is saved only in this browser.");
    expect(card).toHaveTextContent(
      "No backup yet. If this browser’s data is cleared, this pubky is lost.",
    );
    // The safe action is the brand one while nothing protects the key.
    expect(within(card).getByRole("button", { name: "Download recovery file" })).toHaveClass(
      "bg-brand/16",
    );
    expect(
      within(card).queryByRole("button", { name: "Check recovery file" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    // The accessible name starts with the visible label, so speech input reaches it.
    const leave = screen.getByRole("button", { name: "Remove key from this browser" });
    expect(leave).toHaveTextContent("Remove key");
    expect(leave).toHaveAttribute("title", "Remove key from this browser");
  });

  it("keeps Log out once a backup file of the key has opened", () => {
    renderManagement({ identity: { ...browserOnlyIdentity, backup: { verifiedAt: BACKUP_AT } } });

    const card = screen.getByRole("region", { name: "Backup & key access" });
    expect(card).toHaveTextContent(`Recovery file checked on ${BACKUP_DATE}.`);
    expect(card).not.toHaveTextContent("No backup yet");
    expect(within(card).getByRole("button", { name: "Download recovery file" })).not.toHaveClass(
      "bg-brand/16",
    );
    expect(
      within(card).queryByRole("button", { name: "Check recovery file" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("still offers removal, not logout, for a backup file that was never checked", () => {
    const onDownloadRecoveryFile = vi.fn();
    renderManagement({
      identity: { ...browserOnlyIdentity, backup: { createdAt: BACKUP_AT } },
      onDownloadRecoveryFile,
    });

    const card = screen.getByRole("region", { name: "Backup & key access" });
    // Passport made the file but cannot tell that the browser saved it.
    expect(card).toHaveTextContent(
      `Passport made a recovery file on ${BACKUP_DATE}, but it was never checked.`,
    );
    const check = within(card).getByRole("button", { name: "Check recovery file" });
    expect(check).toHaveClass("bg-brand/16");
    expect(within(card).getByRole("button", { name: "Download recovery file" })).not.toHaveClass(
      "bg-brand/16",
    );
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    fireEvent.click(check);
    expect(onDownloadRecoveryFile).toHaveBeenLastCalledWith("manage", true);

    fireEvent.click(screen.getByRole("button", { name: "Remove key from this browser" }));
    expect(
      screen.getByRole("heading", { name: "Remove this key from this browser?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check recovery file" }));
    expect(onDownloadRecoveryFile).toHaveBeenLastCalledWith("logout", true);
    fireEvent.click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(onDownloadRecoveryFile).toHaveBeenLastCalledWith("logout");
  });

  it("checks an unchecked file of a Google-backed key without making it a removal", () => {
    renderManagement({ identity: { ...identity, backup: { createdAt: BACKUP_AT } } });

    const card = screen.getByRole("region", { name: "Backup & key access" });
    expect(within(card).getByRole("button", { name: "Check recovery file" })).not.toHaveClass(
      "bg-brand/16",
    );
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("says a Google-backed key has a copy in Google Drive without warning", () => {
    renderManagement();

    const card = screen.getByRole("region", { name: "Backup & key access" });
    expect(card).toHaveTextContent("backed up, encrypted, to Google Drive");
    expect(card).not.toHaveTextContent("No backup yet");
  });

  it("opens on the logout confirmation when returning to a logout in progress", () => {
    renderManagement({ confirmLogout: true, identity: browserOnlyIdentity });

    expect(
      screen.getByRole("heading", { name: "Remove this key from this browser?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Manage identity." })).toBeInTheDocument();
  });

  it("starts every logout confirmation fresh after Cancel", () => {
    const onBack = vi.fn();
    renderManagement({
      identity: browserOnlyIdentity,
      onBack,
      onRemoveLocalIdentity: () => Result.err({ code: "storage_unavailable" }),
    });
    const failure = "Could not remove the key. Nothing was deleted. Please try again.";

    fireEvent.click(screen.getByRole("button", { name: "Remove key from this browser" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    expect(screen.getByText(failure)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove key from this browser" }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Remove key" })).toBeDisabled();
    expect(screen.queryByText(failure)).not.toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("leaves management after a successful logout", () => {
    const onBack = vi.fn();
    const onRemoveLocalIdentity = vi.fn(() => Result.ok());
    renderManagement({ onBack, onRemoveLocalIdentity });

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(onRemoveLocalIdentity).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });
});

function renderManagement({
  identity: managedIdentity = identity,
  confirmLogout = false,
  onBackupToGoogle,
  onBack = vi.fn(),
  onDownloadRecoveryFile = vi.fn(),
  onRemoveLocalIdentity = () => Result.ok(),
  republishHomeserver = async () => Result.ok(PROVIDER_HOMESERVER),
  resolveHomeserver = async () => Result.ok(PROVIDER_HOMESERVER),
}: {
  identity?: LocalIdentityMetadata;
  confirmLogout?: boolean;
  onBackupToGoogle?: () => void;
  onBack?: () => void;
  onDownloadRecoveryFile?: (returnTo: "manage" | "logout", check?: boolean) => void;
  onRemoveLocalIdentity?: () => LocalIdentityResult<void>;
  republishHomeserver?: (
    publicKeyZ32: string,
    homeserverPubky: string,
  ) => Promise<LocalIdentityHomeserverRepublishResult>;
  resolveHomeserver?: () => Promise<PubkyHomeserverResolutionResult>;
} = {}) {
  return render(
    <IdentityManagement
      identity={managedIdentity}
      confirmLogout={confirmLogout}
      {...(onBackupToGoogle ? { onBackupToGoogle } : {})}
      onBack={onBack}
      onDetachFromGoogle={vi.fn()}
      onDownloadRecoveryFile={onDownloadRecoveryFile}
      onRemoveLocalIdentity={onRemoveLocalIdentity}
      onMigrateToKeychain={vi.fn()}
      providerHomeserver={PROVIDER_HOMESERVER}
      republishHomeserver={republishHomeserver}
      resolveHomeserver={resolveHomeserver}
    />,
  );
}
