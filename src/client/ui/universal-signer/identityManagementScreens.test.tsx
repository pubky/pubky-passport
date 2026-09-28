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
