/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, expect, it, vi } from "vitest";
import { UniversalSignerFlow } from "@/client/ui/universal-signer/universalSignerFlow";
import { fakeLocalIdentityController } from "@test-utils/fakeLocalIdentityController";
import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { LocalStorageIdentityRepository } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import { LocalIdentityController } from "@/client/logic/local-identity/LocalIdentityController";
import { RingProfileController } from "@/client/logic/profile/RingProfileController";
import type { PassportCollaborators } from "@/client/ui/passportCollaborators";
import type { RingProfileGrant } from "@/client/logic/pubky/PubkySdkAdapter";
import { expectResultOk } from "@test-utils/resultAssertions";
import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const RELAY = "https://relay.passport.example/inbox";
/** The pubkys Ring approves here have published no profile yet, so setup stays required. */
const NO_PUBLISHED_PROFILE = { hasProfile: async () => Result.ok(false) };

afterEach(() => {
  cleanup();
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  localStorage.clear();
});

it("keeps the Ring grant when saving its identity opens the profile editor", async () => {
  const repository = new LocalStorageIdentityRepository();
  expectResultOk(repository.saveExternal(KEY, true));
  const connection = {
    authorizationUrl: () => "pubkyauth://signin?secret=passport-profile-only",
    poll: async () => Result.ok(KEY),
    publish: vi.fn(async () => Result.ok()),
    dispose: vi.fn(async () => undefined),
  };
  const ring = new RingProfileController(
    RELAY,
    repository,
    { start: async () => Result.ok(connection as unknown as RingProfileGrant) },
    Date.now,
    NO_PUBLISHED_PROFILE,
  );
  const createRingProfileController = vi.fn<PassportCollaborators["createRingProfileController"]>(
    () => ring,
  );
  render(
    withPassportTestProviders(
      <UniversalSignerFlow />,
      {
        createLocalIdentityController: () => new LocalIdentityController(repository),
        createRingProfileController,
        createAuthorizationController: () =>
          fakePassportAuthorizationController({ current: { status: "manual-entry" } }),
      },
      makeInstanceConfig({ httpRelay: RELAY }),
    ),
  );

  const user = userEvent.setup();
  // Setup is offered from the overview, never forced when the page opens.
  await user.click(await screen.findByRole("button", { name: "Set up profile" }));
  await user.type(await screen.findByLabelText("Name"), "Ring Satoshi");
  // The grant goes through the instance's configured relay.
  expect(createRingProfileController).toHaveBeenCalledWith(RELAY);
  expect(ring.isConnected(KEY)).toBe(true);
  expect(connection.dispose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save profile" }));
  await waitFor(() => expect(connection.publish).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(expectResultOk(repository.list()).identities[0]?.profileSetupRequired).toBeUndefined(),
  );
});

it("returns to the Ring connection when the profile grant has been revoked, keeping the edits", async () => {
  const repository = new LocalStorageIdentityRepository();
  expectResultOk(repository.saveExternal(KEY, true));
  const authorizationUrl = () => "pubkyauth://signin?secret=passport-profile-only";
  const revoked = {
    authorizationUrl,
    poll: vi.fn(async () => Result.ok(KEY)),
    publish: vi.fn(async () => Result.err({ code: "publish_unauthorized" as const })),
    dispose: vi.fn(async () => undefined),
  };
  // Ring approves the new request when the test says so.
  let approveAgain!: () => void;
  const renewed = {
    authorizationUrl,
    poll: vi.fn(
      () =>
        new Promise((resolve) => {
          approveAgain = () => resolve(Result.ok(KEY));
        }),
    ),
    publish: vi.fn(async () => Result.ok()),
    dispose: vi.fn(async () => undefined),
  };
  const start = vi
    .fn()
    .mockResolvedValueOnce(Result.ok(revoked as unknown as RingProfileGrant))
    .mockResolvedValueOnce(Result.ok(renewed as unknown as RingProfileGrant));
  const ring = new RingProfileController(
    RELAY,
    repository,
    { start },
    Date.now,
    NO_PUBLISHED_PROFILE,
  );
  render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      createLocalIdentityController: () => new LocalIdentityController(repository),
      createRingProfileController: () => ring,
      createAuthorizationController: () =>
        fakePassportAuthorizationController({ current: { status: "manual-entry" } }),
    }),
  );

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Set up profile" }));
  await user.type(await screen.findByLabelText("Name"), "Ring Satoshi");
  await user.click(screen.getByRole("button", { name: "Save profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your connection to Pubky Ring ended before your changes were saved.",
  );
  expect(revoked.dispose).toHaveBeenCalledOnce();
  // Saving cannot work until Ring is connected again, so reconnecting takes its place.
  expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reconnect Pubky Ring" }));
  expect(await screen.findByText("Waiting for approval in Pubky Ring…")).toBeInTheDocument();
  expect(start).toHaveBeenCalledTimes(2);
  expect(expectResultOk(repository.list()).identities[0]?.profileSetupRequired).toBe(true);

  // Ring approves again: the editor comes back with what was typed, and publishes nothing yet.
  await act(async () => approveAgain());
  expect(await screen.findByLabelText("Name")).toHaveValue("Ring Satoshi");
  expect(
    screen.getByText(
      "Pubky Ring is connected again. Your changes are still here. Save to publish them.",
    ),
  ).toBeInTheDocument();
  expect(renewed.publish).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save profile" }));
  await waitFor(() => expect(renewed.publish).toHaveBeenCalledOnce());
});

it("asks before leaving the reconnect with kept edits, and drops them once discarded", async () => {
  const repository = new LocalStorageIdentityRepository();
  expectResultOk(repository.saveExternal(KEY, true));
  const authorizationUrl = () => "pubkyauth://signin?secret=passport-profile-only";
  const revoked = {
    authorizationUrl,
    poll: vi.fn(async () => Result.ok(KEY)),
    publish: vi.fn(async () => Result.err({ code: "publish_unauthorized" as const })),
    dispose: vi.fn(async () => undefined),
  };
  // Ring approves every later request at once.
  const renewed = {
    authorizationUrl,
    poll: vi.fn(async () => Result.ok(KEY)),
    publish: vi.fn(async () => Result.ok()),
    dispose: vi.fn(async () => undefined),
  };
  // The reconnect waits until the test lets Ring approve it, so its screen can be left first.
  const pending = {
    authorizationUrl,
    poll: vi.fn(() => new Promise(() => undefined)),
    publish: vi.fn(),
    dispose: vi.fn(async () => undefined),
  };
  const start = vi
    .fn()
    .mockResolvedValueOnce(Result.ok(revoked as unknown as RingProfileGrant))
    .mockResolvedValueOnce(Result.ok(pending as unknown as RingProfileGrant))
    .mockResolvedValue(Result.ok(renewed as unknown as RingProfileGrant));
  const ring = new RingProfileController(
    RELAY,
    repository,
    { start },
    Date.now,
    NO_PUBLISHED_PROFILE,
  );
  render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      createLocalIdentityController: () => new LocalIdentityController(repository),
      createRingProfileController: () => ring,
      createAuthorizationController: () =>
        fakePassportAuthorizationController({ current: { status: "manual-entry" } }),
    }),
  );

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Set up profile" }));
  await user.type(await screen.findByLabelText("Name"), "Ring Satoshi");
  await user.click(screen.getByRole("button", { name: "Save profile" }));
  await user.click(await screen.findByRole("button", { name: "Reconnect Pubky Ring" }));
  // The connection says the edits wait for it, and Back asks before throwing them away.
  expect(
    await screen.findByText("Your unsaved profile changes are kept until you leave."),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("dialog", { name: "Discard your changes?" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("heading", { name: "Connect Pubky Ring." })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(await screen.findByRole("button", { name: "Set up profile" })).toBeInTheDocument();

  // Opened again, the editor shows what is published, not the discarded edits.
  await user.click(screen.getByRole("button", { name: "Set up profile" }));
  expect(screen.queryByText(/Your unsaved profile changes/u)).not.toBeInTheDocument();
  expect(await screen.findByLabelText("Name", {}, { timeout: 3_000 })).toHaveValue("");
  expect(screen.queryByText(/Your changes are still here/u)).not.toBeInTheDocument();
  expect(renewed.publish).not.toHaveBeenCalled();
});

it("reviews an app request before Passport's own profile request, then hands the unchanged request to Ring", async () => {
  const identity: LocalIdentityMetadata = {
    publicIdentity: { publicKeyZ32: KEY },
    keySource: "ring",
    profileSetupRequired: true,
  };
  const state: { catalog: LocalIdentityCatalog; listener?: (() => void) | undefined } = {
    catalog: { activePublicKeyZ32: KEY, identities: [identity] },
  };
  const approve = vi.fn();
  const finishExternalApproval = vi.fn();
  const ring = {
    start: vi.fn(async () => Result.ok()),
    authorizationUrl: () => "pubkyauth://signin?secret=passport-profile-only",
    poll: vi.fn(async () => Result.ok({ status: "waiting" as const })),
    confirm: vi.fn(),
    isConnected: () => false,
    save: vi.fn(),
    dispose: vi.fn(),
  };
  const appRequest = "pubkyauth://signin?secret=original-client-request";
  render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      createLocalIdentityController: () => fakeLocalIdentityController(state),
      createRingProfileController: () => ring,
      createAuthorizationController: () =>
        fakePassportAuthorizationController(
          {
            current: {
              status: "review",
              review: {
                capabilities: [],
                authenticationMethod: "cookie",
                requesterName: "Original app",
                callbackHost: "original.app",
              },
            },
          },
          { approve, externalSignerUrl: () => appRequest, finishExternalApproval },
        ),
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "Sign in to Original app" }),
  ).toBeInTheDocument();
  expect(screen.getAllByLabelText("Signing in to original.app")).toHaveLength(1);
  const user = userEvent.setup();
  // The list labels an identity whose key stays in Ring.
  await user.click(screen.getByRole("button", { name: /Key in Pubky Ring/u }));
  expect(ring.start).not.toHaveBeenCalled();
  expect(screen.getByText(/You’ll pick which identity to use in Pubky Ring/u)).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Continue in Pubky Ring" }));
  expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeInTheDocument();
  // Ring's hand-off names the app as the review does: its label with the website beside it.
  expect(screen.getByText(/approve the sign-in/u)).toHaveTextContent(
    "approve the sign-in to Original app (original.app).",
  );
  expect(screen.getByRole("region", { name: "Sign in with Pubky Ring" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "I approved in Pubky Ring" }));
  expect(finishExternalApproval).toHaveBeenCalledOnce();
  expect(approve).not.toHaveBeenCalled();
  expect(ring.start).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("heading", { name: "Authorization complete." }),
  ).not.toBeInTheDocument();
});

it("adds an existing Ring identity from the home page without an invite or a profile change", async () => {
  const repository = new LocalStorageIdentityRepository();
  const connection = {
    authorizationUrl: () => "pubkyauth://signin?secret=passport-profile-only",
    poll: vi.fn().mockResolvedValueOnce(Result.ok(undefined)).mockResolvedValue(Result.ok(KEY)),
    publish: vi.fn(async () => Result.ok()),
    dispose: vi.fn(async () => undefined),
  };
  const ring = new RingProfileController(
    RELAY,
    repository,
    { start: async () => Result.ok(connection as unknown as RingProfileGrant) },
    Date.now,
    NO_PUBLISHED_PROFILE,
  );
  render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      createLocalIdentityController: () => new LocalIdentityController(repository),
      createRingProfileController: () => ring,
      createAuthorizationController: () =>
        fakePassportAuthorizationController({ current: { status: "manual-entry" } }),
    }),
  );

  const user = userEvent.setup();
  expect(await screen.findByRole("heading", { name: "Get your pubky." })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue with Pubky Ring" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Sign in with Pubky Ring" }));
  expect(await screen.findByRole("heading", { name: "Connect Pubky Ring." })).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: "Pubky Ring profile connection QR code" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("heading", { name: "Your pubky." }, { timeout: 3_000 }),
  ).toBeInTheDocument();
  const catalog = expectResultOk(repository.list());
  expect(catalog.activePublicKeyZ32).toBe(KEY);
  expect(catalog.identities).toEqual([
    { publicIdentity: { publicKeyZ32: KEY }, keySource: "ring" },
  ]);
  // Nothing is published: an existing profile stays as it is.
  expect(connection.publish).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Name")).toBeNull();
});

it("offers the request handoff instead of a profile connection while an app request is pending", async () => {
  render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      createLocalIdentityController: () =>
        fakeLocalIdentityController({ catalog: { activePublicKeyZ32: null, identities: [] } }),
      createAuthorizationController: () =>
        fakePassportAuthorizationController({
          current: {
            status: "review",
            review: { capabilities: [], authenticationMethod: "cookie" },
          },
        }),
    }),
  );
  expect(
    await screen.findByRole("button", { name: "Continue with Pubky Ring" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sign in with Pubky Ring" })).toBeNull();
});
