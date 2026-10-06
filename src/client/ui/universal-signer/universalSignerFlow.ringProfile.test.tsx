/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, expect, it, vi, beforeEach } from "vitest";
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
import { bindTestOpener, releaseTestOpener } from "@test-utils/boundOpener";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const RELAY = "https://relay.passport.example/inbox";
/** The pubkys Ring approves here have published no profile yet, so setup stays required. */
const NO_PUBLISHED_PROFILE = { hasProfile: async () => Result.ok(false) };

beforeEach(() => {
  // The app's v2 hello bound its request from the host it returns to (A39); `window.opener` is
  // reset, so a test says itself whether this page is the app's popup.
  bindTestOpener("https://original.app");
  vi.stubGlobal("opener", null);
});

afterEach(() => {
  releaseTestOpener();
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
  expect(
    await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" }),
  ).toBeInTheDocument();
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

it("opens an app request on the start page when only a Ring identity is saved, then hands the unchanged request to Ring", async () => {
  const identity: LocalIdentityMetadata = {
    publicIdentity: { publicKeyZ32: KEY },
    keySource: "ring",
    profileSetupRequired: true,
  };
  const state: { catalog: LocalIdentityCatalog; listener?: (() => void) | undefined } = {
    catalog: { activePublicKeyZ32: KEY, identities: [identity] },
  };
  const approve = vi.fn();
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
          { approve, externalSignerUrl: () => appRequest },
        ),
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "Signing in to Original app" }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("complementary", { name: "Signing in to original.app" })).toHaveLength(
    1,
  );
  const user = userEvent.setup();
  // The saved identity's key is in Ring, so Passport cannot sign with it: it is not offered, and
  // the request opens as it does with nothing saved. Passport's own profile request stays out.
  expect(screen.queryByText("Key in Pubky Ring")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Create account" })).toBeInTheDocument();
  expect(ring.start).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Continue with Pubky Ring" }));
  expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeInTheDocument();
  // Ring's hand-off names the app as the review does: its label with the website beside it.
  expect(screen.getByText(/approve the sign-in/u)).toHaveTextContent(
    "approve the sign-in to Original app (original.app).",
  );
  expect(screen.getByRole("region", { name: "Sign in with Pubky Ring" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeInTheDocument();
  // Nothing to report: Passport watches for Ring's answer itself.
  expect(screen.queryByRole("button", { name: /approved/iu })).toBeNull();
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

  expect(await screen.findByRole("heading", { name: "Get your pubky." })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue with Pubky Ring" })).toBeNull();
  const card = screen.getByRole("region", { name: "Pubky Ring" });
  // A computer: the connection runs inside the card from the start, with nothing to press or
  // cancel; the start page stays, with the code and no waiting line under it.
  expect(within(card).queryByRole("button", { name: "Sign in with Pubky Ring" })).toBeNull();
  expect(
    await within(card).findByRole("img", { name: "Pubky Ring profile connection QR code" }),
  ).toBeInTheDocument();
  expect(within(card).getByText(/approve to add your pubky to Passport/u)).toBeInTheDocument();
  expect(within(card).queryByText(/Waiting for/u)).toBeNull();
  expect(within(card).queryByRole("button", { name: "Cancel" })).toBeNull();
  // Pressing the code copies its link, for Pubky Ring on this device.
  expect(within(card).getByRole("button", { name: "Copy authentication link" })).toBeEnabled();
  expect(screen.getByRole("heading", { name: "Get your pubky." })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Connect Pubky Ring." })).toBeNull();
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

it("asks Ring for nothing of its own in front of a request that requires a profile", async () => {
  const identity: LocalIdentityMetadata = {
    publicIdentity: { publicKeyZ32: KEY },
    keySource: "ring",
  };
  const state: { catalog: LocalIdentityCatalog; listener?: (() => void) | undefined } = {
    catalog: { activePublicKeyZ32: KEY, identities: [identity] },
  };
  const ring = {
    start: vi.fn(async () => Result.ok()),
    authorizationUrl: () => "pubkyauth://signin?secret=passport-profile-only",
    poll: vi.fn(async () => Result.ok({ status: "waiting" as const })),
    confirm: vi.fn(),
    isConnected: () => false,
    save: vi.fn(),
    dispose: vi.fn(),
  };
  const load = vi.fn(async () => Result.ok(null));
  render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      createLocalIdentityController: () => fakeLocalIdentityController(state),
      createRingProfileController: () => ring,
      createProfileController: () => ({
        load,
        save: vi.fn(),
        checkAvatar: vi.fn(async () => Result.ok(undefined)),
      }),
      createAuthorizationController: () =>
        fakePassportAuthorizationController({
          current: {
            status: "review",
            review: {
              capabilities: [],
              authenticationMethod: "cookie",
              requesterName: "Original app",
              callbackHost: "original.app",
            },
            profileRequired: true,
          },
        }),
    }),
  );
  // A saved Ring identity is not the request's identity, so its profile is neither read nor
  // asked for here: the request opens on the start page, and its Ring sign-in is the way in. The
  // app then asks for the profile itself (`profile-needed`), once it holds a Session.
  expect(
    await screen.findByRole("button", { name: "Continue with Pubky Ring" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Create account" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Connect Pubky Ring." })).not.toBeInTheDocument();
  expect(ring.start).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
});

it("creates the profile an app waits for after its Ring sign-in: grant first, then the editor, then profile-ready", async () => {
  const state: { catalog: LocalIdentityCatalog; listener?: (() => void) | undefined } = {
    catalog: { activePublicKeyZ32: null, identities: [] },
  };
  // What the app asked for on the channel; set once Ring approved its sign-in.
  const app: { needed?: string } = {};
  const profileReady = vi.fn(() => true);
  const authState: Parameters<typeof fakePassportAuthorizationController>[0] = {
    current: {
      status: "review",
      review: {
        capabilities: [],
        authenticationMethod: "cookie",
        requesterName: "Original app",
        callbackHost: "original.app",
      },
      profileRequired: true,
    },
  };
  const authorization = fakePassportAuthorizationController(authState, {
    profileNeeded: () => app.needed,
    profileReady,
  });
  // Ring approves Passport's own grant only once the test says so.
  let approved = false;
  const grant = {
    authorizationUrl: () => "pubkyauth://signin?secret=passport-profile-only",
    poll: async () => Result.ok(approved ? KEY : undefined),
    publish: vi.fn(async () => Result.ok()),
    dispose: vi.fn(async () => undefined),
  };
  const repository = new LocalStorageIdentityRepository();
  const ring = new RingProfileController(
    RELAY,
    repository,
    { start: async () => Result.ok(grant as unknown as RingProfileGrant) },
    Date.now,
    NO_PUBLISHED_PROFILE,
  );
  const rememberProfileNeeded = vi.fn((key: string) => repository.saveExternal(key, true));
  render(
    withPassportTestProviders(
      <UniversalSignerFlow />,
      {
        createLocalIdentityController: () =>
          fakeLocalIdentityController(state, {
            listIdentities: () => repository.list(),
            rememberProfileNeeded,
            subscribeToIdentityChanges: (listener) => repository.subscribe(listener),
          }),
        createRingProfileController: () => ring,
        createAuthorizationController: () => authorization,
      },
      makeInstanceConfig({ httpRelay: RELAY }),
    ),
  );
  // Nothing saved: the request opens on its start page, and the person continues in Ring there.
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Continue with Pubky Ring" }));
  expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeInTheDocument();
  // Ring approved; the app holds the Session, finds no profile and asks on the bound channel.
  app.needed = KEY;
  await act(async () => {
    // The controller re-publishes its (unchanged) review so the screens read the new key.
    authState.current = { ...authState.current! };
    authState.listener?.(authState.current);
  });
  // Passport keeps the identity (setup required) and connects its own write-only grant first.
  expect(rememberProfileNeeded).toHaveBeenCalledWith(KEY);
  // The person just approved the app in Ring: the screen says they are signed in, that the app
  // (named as the band names it) needs a profile, and what this second approval is for.
  expect(await screen.findByRole("heading", { name: "Set up your profile." })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Connect Pubky Ring." })).toBeNull();
  expect(
    screen.getByText(
      "You’re signed in with Pubky Ring, but original.app needs a public profile. Scan this code with Pubky Ring on your phone and approve, so Passport can create it for you. Passport can only edit your profile and avatar; your private key stays in Pubky Ring.",
    ),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Waiting for/u)).toBeNull();
  expect(screen.queryByRole("button", { name: "Skip for now" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  approved = true;
  await waitFor(() => expect(ring.isConnected(KEY)).toBe(true), { timeout: 5_000 });
  // Then the editor, for the app, without a skip; saving publishes and tells the app.
  const name = await screen.findByLabelText("Name", {}, { timeout: 5_000 });
  expect(
    screen.getByText(/The app you’re signing in to needs a public profile/u),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Skip for now" })).not.toBeInTheDocument();
  await user.type(name, "Ring Person");
  await user.click(screen.getByRole("button", { name: "Save profile" }));
  await waitFor(() => expect(grant.publish).toHaveBeenCalledOnce());
  expect(await screen.findByRole("heading", { name: "Profile published." })).toBeInTheDocument();
  expect(profileReady).toHaveBeenCalledOnce();
  expect(expectResultOk(repository.list()).identities[0]?.profileSetupRequired).toBeUndefined();
});

it("a /#profile= page connects Ring for its key without saving anything first, and Back goes home", async () => {
  // A /#profile= page binds only a hello that names its key, never a request: nobody is named.
  releaseTestOpener();
  const state: { catalog: LocalIdentityCatalog; listener?: (() => void) | undefined } = {
    catalog: { activePublicKeyZ32: null, identities: [] },
  };
  const ring = {
    start: vi.fn(async () => Result.ok()),
    authorizationUrl: () => "pubkyauth://signin?secret=passport-profile-only",
    poll: vi.fn(async () => Result.ok({ status: "waiting" as const })),
    confirm: vi.fn(),
    isConnected: () => false,
    save: vi.fn(),
    dispose: vi.fn(),
  };
  const rememberProfileNeeded = vi.fn();
  render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      createLocalIdentityController: () =>
        fakeLocalIdentityController(state, { rememberProfileNeeded }),
      createRingProfileController: () => ring,
      createAuthorizationController: () =>
        fakePassportAuthorizationController(
          { current: { status: "manual-entry" } },
          { profileNeeded: () => KEY },
        ),
    }),
  );
  // Reopened without the request: nothing names the app, so the copy says "this app".
  expect(await screen.findByRole("heading", { name: "Set up your profile." })).toBeInTheDocument();
  expect(
    screen.getByText(/^You’re signed in with Pubky Ring, but this app needs a public profile\./u),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(ring.start).toHaveBeenCalledWith(expect.objectContaining({ expectedKey: KEY })),
  );
  // The link's key is a claim: nothing is saved until Ring approves Passport's grant for it.
  expect(rememberProfileNeeded).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Skip for now" })).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("heading", { name: "Get your pubky." })).toBeInTheDocument();
});
