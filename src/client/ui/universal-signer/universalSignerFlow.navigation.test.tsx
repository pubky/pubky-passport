/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { Keypair } from "@synonymdev/pubky";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { TEST_PROVIDER_HOMESERVER } from "@test-utils/instanceConfig";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { fakeLocalIdentityController } from "@test-utils/fakeLocalIdentityController";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { UniversalSignerFlow } from "./universalSignerFlow";
import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";

const FLOW = {
  catalog: { activePublicKeyZ32: null, identities: [] } as LocalIdentityCatalog,
  listener: undefined as (() => void) | undefined,
  establishIdentity: false,
  requireProfile: false,
  establishmentMode: "created" as "created" | "restored",
  migrationExportKeys: [] as string[],
  republished: [] as Array<[publicKeyZ32: string, homeserverPubky: string]>,
  storageUnavailable: false,
};

const cancel = vi.fn();

function renderSigner(authorization: PassportAuthorizationViewState = { status: "manual-entry" }) {
  return render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      createAuthorizationController: () =>
        fakePassportAuthorizationController({ current: authorization }, { cancel }),
      // Pubky Ring never answers here: the check waits until it is left.
      createRingBackupVerifier: () => ({
        start: async () => Result.ok(),
        poll: async () => Result.ok({ status: "waiting" as const }),
        authorizationUrl: () => "pubkyauth://signin_grant?caps=&secret=verification",
        dispose: () => undefined,
      }),
      createLocalIdentityController: () =>
        fakeLocalIdentityController(FLOW, {
          createPubkyRingMigration: async (publicKeyZ32) => {
            FLOW.migrationExportKeys.push(publicKeyZ32);
            return Result.ok(
              new PubkyRingMigration(
                Keypair.fromSecret(Uint8Array.from({ length: 32 }, (_, index) => index)),
              ),
            );
          },
          republishHomeserver: async (publicKeyZ32, homeserverPubky) => {
            FLOW.republished.push([publicKeyZ32, homeserverPubky]);
            return Result.ok(homeserverPubky);
          },
        }),
      createGoogleIdentityController: () =>
        mockGoogleIdentityController({
          establishIdentity: async () => {
            if (FLOW.establishIdentity) {
              const identity = {
                publicIdentity: { publicKeyZ32: "created" },
                ...(FLOW.requireProfile ? { profileSetupRequired: true as const } : {}),
                googleAccount: {
                  googleSubject: "google-created",
                  email: "created@gmail.com",
                  name: "Created",
                  pictureUrl: null,
                },
              };
              FLOW.catalog = {
                activePublicKeyZ32: identity.publicIdentity.publicKeyZ32,
                identities: [identity],
              };
              FLOW.listener?.();
              return Result.ok({
                establishmentMode: FLOW.establishmentMode,
                googleAccount: identity.googleAccount,
                publicIdentity: identity.publicIdentity,
                visibleRecoveryCopyStatus: "created" as const,
              });
            }
            return Result.err({ code: "authorization_failed" as const });
          },
          detachIdentity: async (publicIdentity: PubkyPublicIdentity) => {
            const identities = FLOW.catalog.identities.map((identity) => {
              if (identity.publicIdentity.publicKeyZ32 !== publicIdentity.publicKeyZ32)
                return identity;
              const detached = { ...identity };
              delete detached.googleAccount;
              return detached;
            });
            FLOW.catalog = {
              activePublicKeyZ32: FLOW.catalog.activePublicKeyZ32,
              identities,
            };
            FLOW.listener?.();
            return Result.ok();
          },
        }),
    }),
  );
}

describe("UniversalSignerFlow identity navigation", () => {
  beforeEach(() => {
    FLOW.catalog = { activePublicKeyZ32: null, identities: [] };
    FLOW.listener = undefined;
    FLOW.establishIdentity = false;
    FLOW.requireProfile = false;
    FLOW.establishmentMode = "created";
    FLOW.migrationExportKeys = [];
    FLOW.republished = [];
    FLOW.storageUnavailable = false;
  });

  afterEach(() => {
    cleanup();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  /** A narrow window on a computer: the migration's code opens in a drawer once asked for. */
  function stubNarrowComputer() {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  }

  it("keeps Google backup completion visible until Continue, then requires profile setup", async () => {
    FLOW.establishIdentity = true;
    FLOW.requireProfile = true;
    const user = userEvent.setup();
    renderSigner();
    await user.click(await screen.findByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "Backup ready." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create your profile." })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("heading", { name: "Create your profile." }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("Name")).toHaveValue("Created");
    expect(screen.queryByRole("button", { name: "Authorize an app" })).not.toBeInTheDocument();
  });

  it("shows the landing page when no local identity exists", async () => {
    renderSigner();
    expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
  });

  it("says why identities are unavailable and offers to reload once that is fixed", async () => {
    FLOW.storageUnavailable = true;
    renderSigner();

    expect(await screen.findByRole("heading", { name: "Identities unavailable." })).toBeVisible();
    expect(
      screen.getByText(
        /Your browser is blocking Passport's storage\. This happens in private windows/u,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Allow site data for this site, then try again.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pubky Ring/u })).not.toBeInTheDocument();
  });

  it("keeps onboarding mounted until setup completion is acknowledged", async () => {
    FLOW.establishIdentity = true;
    renderSigner();

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Backup ready." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your pubky." })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it("returns to the overview directly after restoring an identity", async () => {
    FLOW.establishIdentity = true;
    FLOW.establishmentMode = "restored";
    renderSigner();

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Restore complete." })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });

  it("routes a stored identity to the signed-in home state without borrowing its Google profile", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "identity",
      identities: [
        {
          publicIdentity: { publicKeyZ32: "identity" },
          googleAccount: {
            googleSubject: "google-1",
            email: "satoshi@gmail.com",
            name: "Satoshi Nakamoto",
            pictureUrl: null,
          },
        },
      ],
    };
    renderSigner();
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    // Passport manages the Pubky profile; without profile.json the Google name is not used.
    expect(screen.getByRole("heading", { name: "Pubky identity" })).toBeInTheDocument();
    expect(screen.queryByText("Satoshi Nakamoto")).not.toBeInTheDocument();
    // The overview leaves the Google badge to the switcher and the lists.
    expect(
      screen.queryByRole("group", { name: "Attached Google account: satoshi@gmail.com" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("identity", { exact: true }).tagName).toBe("P");
    expect(screen.queryByRole("button", { name: "Copy Pubky" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Copy Pubky")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage identity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Authorize an app" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download recovery file" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Let’s join Pubky." })).not.toBeInTheDocument();
  });

  it("shows the active identity when several identities exist", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "second",
      identities: [
        { publicIdentity: { publicKeyZ32: "first" } },
        {
          publicIdentity: { publicKeyZ32: "second" },
          profile: { name: "Active Account" },
          googleAccount: {
            googleSubject: "google-2",
            email: "active@gmail.com",
            name: "Active Account",
            pictureUrl: null,
          },
        },
      ],
    };
    renderSigner();

    expect(await screen.findByText("Active Account")).toBeInTheDocument();
    expect(screen.getAllByText("second")[0]).toBeInTheDocument();
    expect(screen.queryByText("first")).not.toBeInTheDocument();
  });

  it("opens the switcher and sends Add identity to the signing flow", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "identity",
      identities: [{ publicIdentity: { publicKeyZ32: "identity" } }],
    };
    renderSigner();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Switch identity" }));
    expect(screen.getByRole("heading", { name: "Switch identity." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));

    // A new account by default, with Back to the switcher.
    expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Switch identity." })).toBeInTheDocument();
  });

  it("gates a newly added identity behind setup completion", async () => {
    FLOW.establishIdentity = true;
    FLOW.catalog = {
      activePublicKeyZ32: "existing",
      identities: [{ publicIdentity: { publicKeyZ32: "existing" } }],
    };
    renderSigner();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Switch identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Backup ready." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your pubky." })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    expect(screen.getAllByText("created")[0]).toBeInTheDocument();
  });

  it("selects the completed Google identity even if another tab changed selection", async () => {
    FLOW.establishIdentity = true;
    renderSigner();
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));
    await screen.findByRole("heading", { name: "Backup ready." });
    const created = FLOW.catalog.identities[0]!;
    act(() => {
      FLOW.catalog = {
        activePublicKeyZ32: "other",
        identities: [{ publicIdentity: { publicKeyZ32: "other" } }, created],
      };
      FLOW.listener?.();
    });
    expect(screen.getByRole("heading", { name: "Backup ready." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    expect(FLOW.catalog.activePublicKeyZ32).toBe("created");
  });

  it("logs out only the active identity and activates a remaining identity", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "first",
      identities: [
        {
          publicIdentity: { publicKeyZ32: "first" },
          googleAccount: {
            googleSubject: "google-1",
            email: "first@gmail.com",
            name: "First",
            pictureUrl: null,
          },
        },
        {
          publicIdentity: { publicKeyZ32: "second" },
          profile: { name: "Second" },
          googleAccount: {
            googleSubject: "google-2",
            email: "second@gmail.com",
            name: "Second",
            pictureUrl: null,
          },
        },
      ],
    };
    renderSigner();

    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Remove from this browser" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Remove from this browser" }));

    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it("opens recovery-file download from identity management", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "identity",
      identities: [{ publicIdentity: { publicKeyZ32: "identity" } }],
    };
    renderSigner();

    expect(screen.queryByRole("button", { name: "Detach from Google" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Download recovery file" }));

    expect(screen.getByRole("heading", { name: "Make a recovery file." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Manage identity." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Detach from Google" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it("opens a backup from the overview and returns there", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "identity",
      identities: [{ publicIdentity: { publicKeyZ32: "identity" } }],
    };
    const user = userEvent.setup();
    renderSigner();

    expect(screen.getByText(/This key is saved only in this browser/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(screen.getByRole("heading", { name: "Make a recovery file." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it.each([
    [
      "the provider homeserver to an identity that does not remember one",
      {},
      TEST_PROVIDER_HOMESERVER,
    ],
    [
      "only the homeserver an identity was signed up on",
      { homeserverPubky: "registered-homeserver" },
      "registered-homeserver",
    ],
  ])("republishes %s", async (_, stored, published) => {
    FLOW.catalog = {
      activePublicKeyZ32: "identity",
      identities: [{ publicIdentity: { publicKeyZ32: "identity" }, ...stored }],
    };
    const user = userEvent.setup();
    renderSigner();

    await user.click(screen.getByRole("button", { name: "Manage identity" }));
    await user.click(await screen.findByRole("button", { name: "Republish homeserver" }));
    // A remembered homeserver is its own answer; the provider's is a question for the person.
    expect(
      screen.getByRole("region", { name: /^(Point this pubky|Was this pubky created)/ }),
    ).toHaveTextContent(published);
    await user.click(screen.getByRole("button", { name: /^(Yes, publish|Publish) record$/ }));

    expect(await screen.findByText("Homeserver record republished.")).toBeInTheDocument();
    expect(FLOW.republished).toEqual([["identity", published]]);
  });

  it("exports the managed identity to Pubky Ring", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "active",
      identities: [
        { publicIdentity: { publicKeyZ32: "inactive" } },
        { publicIdentity: { publicKeyZ32: "active" } },
      ],
    };
    // A narrow window on a computer: the code opens in a drawer (a phone gets no code).
    stubNarrowComputer();
    renderSigner();

    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Migrate to Pubky Ring" }));

    expect(screen.getByRole("heading", { name: "Migrate to Pubky Ring." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(FLOW.migrationExportKeys).toEqual([]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));
    expect(screen.getByRole("dialog", { name: "Scan with Pubky Ring" })).toBeInTheDocument();
    expect(FLOW.migrationExportKeys).toEqual(["active"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    // The export goes on to Verify your backup, which can be left for later.
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Verify your backup." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Migrate to Pubky Ring." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Skip for now" }));
    expect(screen.getByRole("heading", { name: "Manage identity." })).toBeInTheDocument();
  });

  it("secures recovery, confirms detachment, keeps the local identity, and shows completion", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "identity",
      identities: [
        {
          publicIdentity: { publicKeyZ32: "identity" },
          googleAccount: {
            googleSubject: "google",
            email: "user@gmail.com",
            name: "User",
            pictureUrl: null,
          },
        },
      ],
    };
    // A narrow window on a computer: the code opens in a drawer (a phone gets no code).
    stubNarrowComputer();
    renderSigner();

    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Detach from Google" }));

    expect(screen.getByRole("heading", { name: "Back up your pubky first." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Manage identity." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Detach from Google" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Migrate to Pubky Ring" }));
    expect(screen.getByRole("heading", { name: "Migrate to Pubky Ring." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(FLOW.migrationExportKeys).toEqual([]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));
    expect(FLOW.migrationExportKeys).toEqual(["identity"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Skip for now" }));
    expect(screen.getByRole("heading", { name: "Back up your pubky first." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(screen.getByRole("heading", { name: "Make a recovery file." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Back up your pubky first." })).toBeInTheDocument();

    // Nothing proves a backup yet, so the confirmation takes the typed acknowledgement.
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue to detach" }));
    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Detach from Google?" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Detach from Google" }));
    const confirm = screen.getByRole("button", { name: "Confirm detachment" });
    expect(confirm).toBeDisabled();
    await userEvent.setup().type(screen.getByLabelText("Type ONLY COPY to confirm"), "ONLY COPY");
    expect(confirm).toBeEnabled();
    await userEvent.setup().click(confirm);

    expect((await screen.findByText("Detached")).closest("h1")).toBeInTheDocument();
    expect(FLOW.catalog.identities).toEqual([{ publicIdentity: { publicKeyZ32: "identity" } }]);
    expect(FLOW.catalog.activePublicKeyZ32).toBe("identity");
    // Done returns to Manage identity, where detaching started, as attaching does.
    await userEvent.setup().click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("heading", { name: "Manage identity." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Attach to Google" }));
    expect(screen.getByRole("heading", { name: "Attach to Google." })).toBeInTheDocument();
  });

  it("returns to onboarding when another tab removes the identity being managed", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "only",
      identities: [{ publicIdentity: { publicKeyZ32: "only" } }],
    };
    renderSigner();
    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    expect(screen.getByRole("heading", { name: "Manage identity." })).toBeInTheDocument();

    act(() => {
      FLOW.catalog = { activePublicKeyZ32: null, identities: [] };
      FLOW.listener?.();
    });

    expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
  });

  it.each([
    ["Download recovery file", "Make a recovery file."],
    ["Migrate to Pubky Ring", "Migrate to Pubky Ring."],
    ["Attach to Google", "Attach to Google."],
  ])("leaves the %s screen when another tab removes its identity", async (action, heading) => {
    FLOW.catalog = {
      activePublicKeyZ32: "first",
      identities: [
        { publicIdentity: { publicKeyZ32: "first" } },
        { publicIdentity: { publicKeyZ32: "second" } },
      ],
    };
    const user = userEvent.setup();
    renderSigner();
    await user.click(screen.getByRole("button", { name: "Manage identity" }));
    await user.click(screen.getByRole("button", { name: action }));
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();

    act(() => {
      FLOW.catalog = {
        activePublicKeyZ32: "second",
        identities: [{ publicIdentity: { publicKeyZ32: "second" } }],
      };
      FLOW.listener?.();
    });

    expect(screen.queryByRole("heading", { name: heading })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it("returns to signed out when the last identity logs out", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "only",
      identities: [{ publicIdentity: { publicKeyZ32: "only" } }],
    };
    renderSigner();

    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Remove from this browser" }));
    // A browser-only key without a backup must be acknowledged before deletion.
    expect(screen.getByRole("button", { name: "Remove from this browser" })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("checkbox"));
    await userEvent.setup().click(screen.getByRole("button", { name: "Remove from this browser" }));

    expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
  });

  it("returns to the logout confirmation after the backup it asked for", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "only",
      identities: [{ publicIdentity: { publicKeyZ32: "only" } }],
    };
    const user = userEvent.setup();
    renderSigner();

    await user.click(screen.getByRole("button", { name: "Manage identity" }));
    await user.click(screen.getByRole("button", { name: "Remove from this browser" }));
    await user.click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(screen.getByRole("heading", { name: "Make a recovery file." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("heading", { name: "Remove this key from this browser?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Download recovery file" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Manage identity." })).toBeInTheDocument();
  });
});

describe("UniversalSignerFlow start page screens", () => {
  const REVIEW = {
    authenticationMethod: "cookie",
    capabilities: [{ path: "/pub/requesting.app/", read: true, write: true, scope: "specific" }],
  } as const;
  const TWO_SAVED: LocalIdentityCatalog = {
    activePublicKeyZ32: "first",
    identities: [
      { publicIdentity: { publicKeyZ32: "first" } },
      { publicIdentity: { publicKeyZ32: "second" } },
    ],
  };

  beforeEach(() => {
    FLOW.catalog = { activePublicKeyZ32: null, identities: [] };
    FLOW.listener = undefined;
    FLOW.storageUnavailable = false;
  });

  afterEach(() => {
    cleanup();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("opens on Join without a request, whose header leads to Sign in, and Back returns to Join", async () => {
    const user = userEvent.setup();
    renderSigner();

    expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign in to Pubky");
    // Join is one Back away, so Sign in's header has no link there of its own.
    expect(screen.queryByRole("button", { name: "New here?" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
  });

  it("keeps a request on Join, with Sign in's ways in under its cards instead of a switch", async () => {
    const user = userEvent.setup();
    // The app's "Join now" opened Join; a request's Join has no header link to Sign in.
    renderSigner({ status: "review", review: REVIEW, entry: "join" });

    await screen.findByRole("heading", { name: "Let’s join Pubky." });
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New here?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import it" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Pubky Ring" })).toBeInTheDocument();
    // Back on the screen the request opened on answers the app.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("goes Back to Join from the Sign in it opened, without a request", async () => {
    const user = userEvent.setup();
    renderSigner();

    // The first screen has nowhere to go back to.
    await screen.findByRole("heading", { name: "Let’s join Pubky." });
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
  });

  it.each([undefined, "sign-in"] as const)(
    "opens a request with nothing to sign with on its Join, where Back answers the app, entry=%s",
    async (entry) => {
      renderSigner({ status: "review", review: REVIEW, ...(entry ? { entry } : {}) });

      expect(await screen.findByRole("heading", { level: 1 })).toHaveAccessibleName(
        "Let’s join Pubky.",
      );
      expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Import it" })).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["join", "Let’s join Pubky."],
    ["google", "Continue with Google."],
  ] as const)(
    "opens a request whose app asked for %s on that screen, answering the app on Back",
    async (entry, heading) => {
      renderSigner({ status: "review", review: REVIEW, entry });

      expect(await screen.findByRole("heading", { level: 1 })).toHaveAccessibleName(heading);
      await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["join", "Let’s join Pubky."],
    ["google", "Continue with Google."],
  ] as const)(
    "opens on %s even with identities saved, with Back to their list",
    async (entry, heading) => {
      FLOW.catalog = TWO_SAVED;
      renderSigner({ status: "review", review: REVIEW, entry });

      expect(await screen.findByRole("heading", { level: 1 })).toHaveAccessibleName(heading);
      expect(screen.queryByText("Choose the identity to sign in with.")).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
      expect(screen.getByText("Choose the identity to sign in with.")).toBeInTheDocument();
      expect(cancel).not.toHaveBeenCalled();
    },
  );

  it("lists the saved identities for a request that asked for Sign in", async () => {
    FLOW.catalog = TWO_SAVED;
    renderSigner({ status: "review", review: REVIEW, entry: "sign-in" });

    expect(await screen.findByText("Choose the identity to sign in with.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New here?" })).not.toBeInTheDocument();
  });

  it("returns from account creation to the request's Join it was opened from", async () => {
    const user = userEvent.setup();
    renderSigner({ status: "review", review: REVIEW });

    await screen.findByRole("heading", { name: "Let’s join Pubky." });
    await user.click(screen.getByRole("button", { name: "Manage your own keys" }));
    expect(
      await screen.findByRole("heading", { name: "Prove you’re not a robot." }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByRole("heading", { level: 1 })).toHaveAccessibleName(
      "Let’s join Pubky.",
    );
    expect(cancel).not.toHaveBeenCalled();
    // The request's first screen again: Back answers the app.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns from account creation to Join where the app asked for Join", async () => {
    const user = userEvent.setup();
    renderSigner({ status: "review", review: REVIEW, entry: "join" });

    await screen.findByRole("heading", { name: "Let’s join Pubky." });
    await user.click(screen.getByRole("button", { name: "Manage your own keys" }));
    expect(
      await screen.findByRole("heading", { name: "Prove you’re not a robot." }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns from account creation to Join without a request", async () => {
    const user = userEvent.setup();
    renderSigner();

    await screen.findByRole("heading", { name: "Let’s join Pubky." });
    await user.click(screen.getByRole("button", { name: "Manage your own keys" }));
    expect(
      await screen.findByRole("heading", { name: "Prove you’re not a robot." }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
  });

  it("returns from import to Sign in, even where the page opened on Join", async () => {
    const user = userEvent.setup();
    renderSigner();

    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    await user.click(screen.getByRole("button", { name: "Import it" }));
    expect(
      await screen.findByRole("heading", { name: "Import recovery file." }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByRole("heading", { level: 1 })).toHaveAccessibleName(
      "Sign in to Pubky",
    );
  });
});
