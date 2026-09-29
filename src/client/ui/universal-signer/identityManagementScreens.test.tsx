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
  republishHomeserver: async (_publicKeyZ32, homeserverPubky) => Result.ok(homeserverPubky),
  resolveHomeserver: async () => Result.ok(null),
  selectIdentity: () => Result.ok(),
  verifyRecoveryFile: async () => Result.ok(),
};

function renderScreens(
  navigation: ManagementNavigation,
  {
    catalog = CATALOG,
    instance,
  }: { catalog?: LocalIdentityCatalog; instance?: PassportProvider | undefined } = {},
) {
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
      {},
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
    cleanup();

    renderScreens({ view: "recovery", publicKeyZ32: "managed", check: true });
    expect(screen.getByRole("heading", { name: "Verify recovery file." })).toBeInTheDocument();
    expect(screen.getByLabelText("Recovery file")).toBeInTheDocument();
    expect(screen.queryByLabelText("Enter strong password")).not.toBeInTheDocument();
  });

  it("opens the backup check from Manage for a file that was never checked", async () => {
    const created = {
      activePublicKeyZ32: "local",
      identities: [
        {
          publicIdentity: { publicKeyZ32: "local" },
          backup: { createdAt: "2026-09-01T10:00:00.000Z" },
        } as const,
      ],
    };
    const { onNavigate } = renderScreens(
      { view: "manage", publicKeyZ32: "local" },
      { catalog: created },
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Check backup" }));
    expect(onNavigate).toHaveBeenCalledWith({
      view: "recovery",
      publicKeyZ32: "local",
      check: true,
    });
  });

  it("starts detachment with the identity as it was, and returns to it", async () => {
    const user = userEvent.setup();
    const manage = renderScreens({ view: "manage", publicKeyZ32: "managed" });
    await user.click(screen.getByRole("button", { name: "Detach from Google" }));
    expect(manage.onNavigate).toHaveBeenCalledWith({
      view: "detach",
      identity: IDENTITY,
      googleSubject: "google-managed",
    });
    cleanup();

    const detach = renderScreens(
      { view: "detach", identity: IDENTITY, googleSubject: "google-managed" },
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
