/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import type { ManagementNavigation } from "@/client/logic/universal-signer/signerNavigation";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import type { PassportProvider } from "@/libs/passportProvider";
import type { IdentityCatalogActions } from "@/client/ui/identity-catalog/useIdentityCatalog";
import type { RingBackupVerifierPort } from "@/client/ui/passportCollaborators";
import { IdentityManagementScreens } from "./identityManagementScreens";

const IDENTITY = {
  publicIdentity: { publicKeyZ32: "managed" },
  googleAccount: {
    googleSubject: "google-managed",
    email: "managed@example.com",
    name: "Managed",
    pictureUrl: null,
  },
};
const CATALOG: LocalIdentityCatalog = { activePublicKeyZ32: "managed", identities: [IDENTITY] };
const ACTIONS: IdentityCatalogActions = {
  createMigration: async () => Result.err({ code: "invalid_identity" as const }),
  createRecoveryFile: async () => Result.err({ code: "recovery_file_failed" as const }),
  removeIdentity: () => Result.ok(),
  rememberProfileNeeded: () => Result.ok(undefined),
  republishHomeserver: async (_publicKeyZ32, homeserverPubky) => Result.ok(homeserverPubky),
  resolveHomeserver: async () => Result.ok(null),
  selectIdentity: () => Result.ok(),
  verifyRecoveryFile: async () => Result.ok(),
};

/** A Ring check that waits for an approval that never comes. */
function neverApproves(): RingBackupVerifierPort {
  return {
    start: vi.fn(async () => Result.ok()),
    poll: vi.fn(async () => Result.ok({ status: "waiting" as const })),
    authorizationUrl: vi.fn(() => "pubkyauth://signin_grant?caps=&secret=s"),
    dispose: vi.fn(),
  };
}

function renderScreens(
  navigation: ManagementNavigation,
  {
    catalog = CATALOG,
    instance,
    verifier,
  }: {
    catalog?: LocalIdentityCatalog;
    instance?: PassportProvider | undefined;
    verifier?: RingBackupVerifierPort;
  } = {},
) {
  // Pubky Ring never answers here unless the test says otherwise.
  const ring = verifier ?? neverApproves();
  const callbacks = {
    onEditProfile: vi.fn(),
    onHome: vi.fn(),
    onNavigate: vi.fn(),
    onRemoveLocalIdentity: vi.fn(() => Result.ok()),
  };
  const view = render(
    withPassportTestProviders(
      <IdentityManagementScreens
        actions={ACTIONS}
        catalog={catalog}
        navigation={navigation}
        {...callbacks}
      />,
      { createRingBackupVerifier: () => ring },
      instance,
    ),
  );
  return { ...callbacks, container: view.container };
}

describe("IdentityManagementScreens", () => {
  afterEach(cleanup);

  it.each(["recovery", "ring", "backup-to-google"] as const)(
    "returns from %s to managing the same identity",
    async (view) => {
      const { onNavigate } = renderScreens({ view, publicKeyZ32: "managed" });

      await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));

      expect(onNavigate).toHaveBeenCalledWith({ view: "manage", publicKeyZ32: "managed" });
    },
  );

  it("returns a backup to the screen that asked for it, and requires its check before a removal", async () => {
    const user = userEvent.setup();
    const home = renderScreens({ view: "recovery", publicKeyZ32: "managed", home: true });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(home.onHome).toHaveBeenCalledOnce();
    expect(home.onNavigate).not.toHaveBeenCalled();
    cleanup();

    const logout = renderScreens({ view: "recovery", publicKeyZ32: "managed", logout: true });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(logout.onNavigate).toHaveBeenCalledWith({
      view: "manage",
      publicKeyZ32: "managed",
      logout: true,
    });
  });

  it("opens Verify your backup from Manage, and from the removal confirmation's check", async () => {
    const created = {
      activePublicKeyZ32: "local",
      identities: [
        {
          publicIdentity: { publicKeyZ32: "local" },
          backup: { createdAt: "2026-09-01T10:00:00.000Z" },
        } as const,
      ],
    };
    const user = userEvent.setup();
    const { onNavigate } = renderScreens(
      { view: "manage", publicKeyZ32: "local" },
      { catalog: created },
    );
    await user.click(screen.getByRole("button", { name: "Verify backup" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ view: "verify", publicKeyZ32: "local" });
    // The file Passport made was never checked: removing asks for its check first, on the same
    // page, which then returns to the confirmation.
    await user.click(screen.getByRole("button", { name: "Remove from this browser" }));
    await user.click(screen.getByRole("button", { name: "Check recovery file" }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      view: "verify",
      publicKeyZ32: "local",
      from: "logout",
    });
  });

  it("shows both checks on one page, whose Back returns to where it was opened", async () => {
    const user = userEvent.setup();
    const manage = renderScreens({ view: "verify", publicKeyZ32: "managed" });
    expect(screen.getByRole("heading", { name: "Verify your backup." })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recovery file" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pubky Ring" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Back" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Skip for now" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(manage.onNavigate).toHaveBeenCalledWith({ view: "manage", publicKeyZ32: "managed" });
    cleanup();

    const home = renderScreens({ view: "verify", publicKeyZ32: "managed", from: "home" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(home.onHome).toHaveBeenCalledOnce();
    cleanup();

    const logout = renderScreens({ view: "verify", publicKeyZ32: "managed", from: "logout" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(logout.onNavigate).toHaveBeenCalledWith({
      view: "manage",
      publicKeyZ32: "managed",
      logout: true,
    });
  });

  it("goes on from Migrate to Pubky Ring to Verify your backup, which can be skipped", async () => {
    const user = userEvent.setup();
    const migrate = renderScreens({ view: "ring", publicKeyZ32: "managed" });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(migrate.onNavigate).toHaveBeenCalledWith({
      view: "verify",
      publicKeyZ32: "managed",
      from: "ring",
    });
    cleanup();

    const step = renderScreens({ view: "verify", publicKeyZ32: "managed", from: "ring" });
    expect(screen.getByRole("heading", { name: "Verify your backup." })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(step.onNavigate).toHaveBeenLastCalledWith({ view: "manage", publicKeyZ32: "managed" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(step.onNavigate).toHaveBeenLastCalledWith({ view: "ring", publicKeyZ32: "managed" });
  });

  it("starts detachment with the identity as it was, and returns to it", async () => {
    const user = userEvent.setup();
    const manage = renderScreens({ view: "manage", publicKeyZ32: "managed" });
    await user.click(screen.getByRole("button", { name: "Detach from Google" }));
    expect(manage.onNavigate).toHaveBeenCalledWith({
      view: "detach",
      identity: IDENTITY,
      googleAccount: IDENTITY.googleAccount,
    });
    cleanup();

    const detach = renderScreens(
      { view: "detach", identity: IDENTITY, googleAccount: IDENTITY.googleAccount },
      { catalog: { activePublicKeyZ32: null, identities: [] } },
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(detach.onNavigate).toHaveBeenCalledWith({ view: "manage", publicKeyZ32: "managed" });
  });

  it("offers Google backup only when the instance runs with Google", async () => {
    const detached = {
      activePublicKeyZ32: "local",
      identities: [{ publicIdentity: { publicKeyZ32: "local" } }],
    };
    const configured = renderScreens(
      { view: "manage", publicKeyZ32: "local" },
      { catalog: detached },
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Attach to Google" }));
    expect(configured.onNavigate).toHaveBeenCalledWith({
      view: "backup-to-google",
      publicKeyZ32: "local",
    });
    cleanup();

    renderScreens(
      { view: "manage", publicKeyZ32: "local" },
      { catalog: detached, instance: makeInstanceConfig({ features: { google: false } }) },
    );
    expect(screen.queryByRole("button", { name: "Attach to Google" })).not.toBeInTheDocument();
  });

  it("renders nothing for an identity that is no longer saved", () => {
    const { container } = renderScreens(
      { view: "manage", publicKeyZ32: "gone" },
      { catalog: { activePublicKeyZ32: null, identities: [] } },
    );

    expect(container).toBeEmptyDOMElement();
  });
});
