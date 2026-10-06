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
    // No initials of a placeholder or of the Google name: pubky.app's face for the key.
    expect(profile.querySelector("[data-facehash]")).toHaveTextContent(/^X$/u);
    expect(within(profile).queryByText("PU")).not.toBeInTheDocument();
    expect(within(profile).queryByText("SA")).not.toBeInTheDocument();
  });

  it("puts no custody tag under the name, leaving Google to its card", () => {
    // A key held only in this browser is the ordinary case and gets no tag.
    renderManagement({ identity: browserOnlyIdentity });
    expect(screen.queryByText(/Key in this browser/u)).not.toBeInTheDocument();
    cleanup();

    renderManagement();
    expect(
      within(screen.getByRole("region", { name: "Public profile" })).queryByRole("group", {
        name: /^Attached Google account/u,
      }),
    ).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Remove from this browser" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Public profile" })).toContainElement(
      screen.getByRole("group", { name: "Homeserver" }),
    );
  });

  it("puts Remove from this browser after the key's backups, leaving the profile card to the profile", () => {
    const onEditProfile = vi.fn();
    renderManagement({ onEditProfile });

    // One action leaves this browser, and for a key saved here it sits with its backups.
    const remove = screen.getByRole("button", { name: "Remove from this browser" });
    const keyCard = screen.getByRole("region", { name: "Backup & key access" });
    expect(keyCard).toContainElement(remove);
    // The card's order: Back up (Pubky Ring and the recovery file on one row), Verify, the Google
    // account, then removing, set apart.
    expect(
      within(keyCard)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim()),
    ).toEqual([
      "Migrate to Pubky Ring",
      "Download recovery file",
      "Verify backup",
      "Detach from Google",
      "Remove from this browser",
    ]);
    const backUp = within(keyCard).getByRole("region", { name: "Back up" });
    const verify = within(keyCard).getByRole("region", { name: "Verify" });
    expect(
      within(backUp)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim()),
    ).toEqual(["Migrate to Pubky Ring", "Download recovery file"]);
    expect(
      within(verify)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim()),
    ).toEqual(["Verify backup"]);
    expect(remove.parentElement).toHaveClass("border-t", "pt-6");
    expect(keyCard.lastElementChild).toBe(remove.parentElement);
    const ring = within(keyCard).getByRole("button", { name: "Migrate to Pubky Ring" });
    expect(ring.parentElement).toBe(
      within(keyCard).getByRole("button", { name: "Download recovery file" }).parentElement,
    );
    // Both ways to back up look alike: plain secondary buttons, without an outline.
    expect(ring).toHaveClass("bg-secondary", "border-transparent");
    expect(ring).not.toHaveClass("border-brand/64", "bg-brand/16");
    expect(ring.className).toBe(
      within(keyCard).getByRole("button", { name: "Download recovery file" }).className,
    );
    expect(screen.getByRole("region", { name: "Google account" })).not.toContainElement(remove);
    expect(screen.queryByRole("button", { name: /Log out|Remove key/u })).not.toBeInTheDocument();
    // The profile card keeps only the profile's own action, at the end of the row that names the
    // identity (wrapping under the name where the row is narrow), before the bio and the pubky.
    const profileCard = screen.getByRole("region", { name: "Public profile" });
    expect(profileCard).not.toContainElement(remove);
    const editProfile = within(profileCard).getByRole("button", { name: "Edit profile" });
    const nameRow = editProfile.parentElement!;
    expect(nameRow).toHaveClass("flex", "flex-wrap", "justify-between");
    // The identity's name is the row's bold line.
    expect(nameRow.querySelector("p.text-xl")).not.toBeNull();
    expect(nameRow.lastElementChild).toBe(editProfile);
    expect(editProfile).toHaveClass("bg-secondary");
    expect(editProfile.compareDocumentPosition(within(profileCard).getByText("Pubky"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // No action row is left at the bottom of the card.
    expect(profileCard.lastElementChild).not.toContainElement(editProfile);
    fireEvent.click(editProfile);
    expect(onEditProfile).toHaveBeenCalledOnce();

    fireEvent.click(remove);
    expect(
      screen.getByRole("heading", { name: "Remove this identity from this browser?" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove from this browser" })).toHaveClass(
      "bg-destructive-surface",
    );
  });

  it("shows the Google account's picture and address, with Detach as the row's danger action", () => {
    const onDetachFromGoogle = vi.fn();
    renderManagement({
      identity: {
        ...identity,
        googleAccount: {
          ...identity.googleAccount,
          pictureUrl: "https://lh3.googleusercontent.com/a/picture",
        },
      },
      onDetachFromGoogle,
    });

    const section = screen.getByRole("region", { name: "Google account" });
    const account = within(section).getByRole("group", {
      name: "Attached Google account: satoshi@gmail.com",
    });
    expect(account).toHaveTextContent("satoshi@gmail.com");
    expect(within(account).getByTestId("google-account-picture")).toHaveAttribute(
      "src",
      "https://lh3.googleusercontent.com/a/picture",
    );
    const detach = within(section).getByRole("button", { name: "Detach from Google" });
    expect(detach).toHaveClass("bg-destructive-surface");
    // One row wherever the card has room, stacked in a narrow one.
    expect(detach.parentElement).toBe(account.parentElement);
    expect(detach.parentElement).toHaveClass("flex-col", "@sm:flex-row", "@sm:justify-between");
    expect(detach.parentElement?.parentElement).toHaveClass("@container");

    fireEvent.click(detach);
    expect(onDetachFromGoogle).toHaveBeenCalledOnce();
  });

  it("falls back to the Google mark when the account has no picture or it fails to load", () => {
    renderManagement();

    const account = within(screen.getByRole("region", { name: "Google account" })).getByRole(
      "group",
      { name: "Attached Google account: satoshi@gmail.com" },
    );
    expect(within(account).queryByTestId("google-account-picture")).not.toBeInTheDocument();
    expect(account.querySelector("svg")).not.toBeNull();
    cleanup();

    renderManagement({
      identity: {
        ...identity,
        googleAccount: {
          ...identity.googleAccount,
          pictureUrl: "https://lh3.googleusercontent.com/a/x",
        },
      },
    });
    const picture = screen.getByTestId("google-account-picture");
    fireEvent.error(picture);
    expect(screen.queryByTestId("google-account-picture")).not.toBeInTheDocument();
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

  it("downloads a backup and returns to the screen it was requested from", () => {
    const onDownloadRecoveryFile = vi.fn();
    renderManagement({ identity: browserOnlyIdentity, onDownloadRecoveryFile });

    fireEvent.click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(onDownloadRecoveryFile).toHaveBeenLastCalledWith("manage");

    fireEvent.click(screen.getByRole("button", { name: "Remove from this browser" }));
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
    // Verifying is always offered, saying no backup of this key was verified yet.
    expect(within(card).getByRole("button", { name: "Verify backup" })).not.toHaveClass(
      "bg-brand/16",
    );
    expect(within(card).getByRole("region", { name: "Verify" })).toHaveTextContent(
      "Never verified",
    );
    // The same action as for every identity; what it risks is said before it is confirmed.
    const leave = screen.getByRole("button", { name: "Remove from this browser" });
    expect(card).toContainElement(leave);
  });

  it("keeps Log out once a backup file of the key has opened", () => {
    const onVerifyBackup = vi.fn();
    renderManagement({
      identity: { ...browserOnlyIdentity, backup: { verifiedAt: BACKUP_AT } },
      onVerifyBackup,
    });

    const card = screen.getByRole("region", { name: "Backup & key access" });
    expect(card).not.toHaveTextContent("No backup yet");
    expect(within(card).getByRole("button", { name: "Download recovery file" })).not.toHaveClass(
      "bg-brand/16",
    );
    // Backups can be verified again; the date and kind of the last check sit on the same row.
    const verify = within(card).getByRole("button", { name: "Verify backup" });
    expect(verify.parentElement).toHaveTextContent(`Last verified ${BACKUP_DATE} (Recovery file)`);
    expect(verify.parentElement).not.toContainElement(
      within(card).getByRole("button", { name: "Download recovery file" }),
    );
    fireEvent.click(verify);
    expect(onVerifyBackup).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Remove from this browser" })).toBeInTheDocument();
  });

  it("still offers removal, not logout, for a backup file that was never checked", () => {
    const onDownloadRecoveryFile = vi.fn();
    const onVerifyBackup = vi.fn();
    renderManagement({
      identity: { ...browserOnlyIdentity, backup: { createdAt: BACKUP_AT } },
      onDownloadRecoveryFile,
      onVerifyBackup,
    });

    const card = screen.getByRole("region", { name: "Backup & key access" });
    // Passport made the file but cannot tell that the browser saved it.
    expect(card).toHaveTextContent(
      `Passport made a recovery file on ${BACKUP_DATE}, but it was never checked.`,
    );
    // Verifying the file already made is the quickest way to protect the key, so it is the brand
    // action.
    const verify = within(card).getByRole("button", { name: "Verify backup" });
    expect(verify).toHaveClass("bg-brand/16");
    expect(verify.parentElement).toHaveTextContent("Never verified");
    expect(within(card).getByRole("button", { name: "Download recovery file" })).not.toHaveClass(
      "bg-brand/16",
    );
    fireEvent.click(verify);
    expect(onVerifyBackup).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Remove from this browser" }));
    expect(
      screen.getByRole("heading", { name: "Remove this key from this browser?" }),
    ).toBeInTheDocument();
    // Checking the file opens Verify your backup, which returns to this confirmation.
    fireEvent.click(screen.getByRole("button", { name: "Check recovery file" }));
    expect(onVerifyBackup).toHaveBeenLastCalledWith("logout");
    fireEvent.click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(onDownloadRecoveryFile).toHaveBeenLastCalledWith("logout");
  });

  it("checks an unchecked file of a Google-backed key without making it a removal", () => {
    renderManagement({ identity: { ...identity, backup: { createdAt: BACKUP_AT } } });

    const card = screen.getByRole("region", { name: "Backup & key access" });
    expect(within(card).getByRole("button", { name: "Verify backup" })).not.toHaveClass(
      "bg-brand/16",
    );
    // The file is still said to be unchecked; Google's copy keeps it from being a removal.
    expect(card).toHaveTextContent("but it was never checked");
    expect(screen.getByRole("button", { name: "Remove from this browser" })).toBeInTheDocument();
  });

  it("counts a copy verified in Pubky Ring as the key's backup, like a checked file", () => {
    renderManagement({
      identity: {
        ...browserOnlyIdentity,
        backup: { createdAt: BACKUP_AT, ringVerifiedAt: BACKUP_AT },
      },
    });

    const card = screen.getByRole("region", { name: "Backup & key access" });
    expect(within(card).getByRole("region", { name: "Verify" })).toHaveTextContent(
      `Last verified ${BACKUP_DATE} (Pubky Ring)`,
    );
    // No warning, and no brand action: the key is protected.
    expect(card).not.toHaveTextContent("No backup yet");
    expect(card).not.toHaveTextContent("never checked");
    expect(within(card).getByRole("button", { name: "Verify backup" })).not.toHaveClass(
      "bg-brand/16",
    );
    expect(within(card).getByRole("button", { name: "Download recovery file" })).not.toHaveClass(
      "bg-brand/16",
    );
    // Removing it is leaving an identity whose key Pubky Ring holds, which its owner confirms.
    fireEvent.click(screen.getByRole("button", { name: "Remove from this browser" }));
    expect(
      screen.getByRole("heading", { name: "Remove this identity from this browser?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Pubky Ring signed in with this key on ${BACKUP_DATE}.`, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from this browser" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "This key is still in my Pubky Ring." }));
    expect(screen.getByRole("button", { name: "Remove from this browser" })).toBeEnabled();
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

    fireEvent.click(screen.getByRole("button", { name: "Remove from this browser" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Remove from this browser" }));
    expect(screen.getByText(failure)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove from this browser" }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Remove from this browser" })).toBeDisabled();
    expect(screen.queryByText(failure)).not.toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("leaves management after a successful logout", () => {
    const onBack = vi.fn();
    const onRemoveLocalIdentity = vi.fn(() => Result.ok());
    renderManagement({ onBack, onRemoveLocalIdentity });

    fireEvent.click(screen.getByRole("button", { name: "Remove from this browser" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from this browser" }));

    expect(onRemoveLocalIdentity).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });
});

function renderManagement({
  identity: managedIdentity = identity,
  confirmLogout = false,
  onBackupToGoogle,
  onBack = vi.fn(),
  onDetachFromGoogle = vi.fn(),
  onDownloadRecoveryFile = vi.fn(),
  onEditProfile,
  onRemoveLocalIdentity = () => Result.ok(),
  onVerifyBackup = vi.fn(),
  republishHomeserver = async () => Result.ok(PROVIDER_HOMESERVER),
  resolveHomeserver = async () => Result.ok(PROVIDER_HOMESERVER),
}: {
  identity?: LocalIdentityMetadata;
  confirmLogout?: boolean;
  onBackupToGoogle?: () => void;
  onBack?: () => void;
  onDetachFromGoogle?: () => void;
  onEditProfile?: () => void;
  onDownloadRecoveryFile?: (returnTo: "manage" | "logout", check?: boolean) => void;
  onRemoveLocalIdentity?: () => LocalIdentityResult<void>;
  onVerifyBackup?: () => void;
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
      onDetachFromGoogle={onDetachFromGoogle}
      {...(onEditProfile ? { onEditProfile } : {})}
      onDownloadRecoveryFile={onDownloadRecoveryFile}
      onRemoveLocalIdentity={onRemoveLocalIdentity}
      onMigrateToKeychain={vi.fn()}
      onVerifyBackup={onVerifyBackup}
      providerHomeserver={PROVIDER_HOMESERVER}
      republishHomeserver={republishHomeserver}
      resolveHomeserver={resolveHomeserver}
    />,
  );
}
