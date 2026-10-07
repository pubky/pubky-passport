/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UniversalSignerFlow } from "@/client/ui/universal-signer/universalSignerFlow";
import { fakeLocalIdentityController } from "@test-utils/fakeLocalIdentityController";
import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import type { EditProfileEntry } from "@/client/logic/authorization/entry/editProfileEntry";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const OTHER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const profile = { name: "Satoshi", bio: "Bitcoin", links: [], image: null, status: "busy" };
const load = vi.fn();
const save = vi.fn();
const checkAvatar = vi.fn(async () => Result.ok(undefined));
const profileUpdated = vi.fn(() => true);
let state: { catalog: LocalIdentityCatalog; listener?: (() => void) | undefined };

function ringConnection(connected = false) {
  return {
    start: vi.fn(async () => Result.ok()),
    authorizationUrl: () => "pubkyauth://signin?secret=passport-profile-only",
    poll: vi.fn(async () => Result.ok({ status: "waiting" as const })),
    confirm: vi.fn(),
    isConnected: (key?: string) => connected && key === KEY,
    save: vi.fn(),
    dispose: vi.fn(),
  };
}

function mount(entry: EditProfileEntry, ring = ringConnection()) {
  return render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      createLocalIdentityController: () => fakeLocalIdentityController(state),
      createProfileController: () => ({ load, save, checkAvatar }),
      createRingProfileController: () => ring,
      createAuthorizationController: () =>
        fakePassportAuthorizationController(
          { current: { status: "manual-entry" } },
          { editProfileEntry: () => entry, profileUpdated },
        ),
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("opener", null);
  state = {
    catalog: {
      activePublicKeyZ32: OTHER,
      identities: [
        { publicIdentity: { publicKeyZ32: OTHER }, profile: { name: "Other" } },
        { publicIdentity: { publicKeyZ32: KEY }, profile: { name: "Satoshi" } },
      ],
    },
  };
  load.mockResolvedValue(Result.ok({ profile }));
  save.mockResolvedValue(Result.ok({ ...profile, name: "Satoshi Nakamoto" }));
});

afterEach(() => {
  cleanup();
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("opens the editor of the linked browser key, not the active one, and tells the app", async () => {
  const user = userEvent.setup();
  mount({ status: "edit", publicKeyZ32: KEY });
  const name = await screen.findByLabelText("Name");
  expect(load).toHaveBeenCalledWith(KEY);
  // An edit is no setup: no steps, no skip, and Back goes to Passport's home.
  expect(screen.queryByRole("button", { name: "Skip for now" })).not.toBeInTheDocument();
  await user.clear(name);
  await user.type(name, "Satoshi Nakamoto");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("heading", { name: "Profile updated." })).toBeInTheDocument();
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0]?.[0]).toBe(KEY);
  expect(profileUpdated).toHaveBeenCalledOnce();
  expect(
    screen.getByText("The app that opened Passport knows: it shows your new profile."),
  ).toBeInTheDocument();
});

it("says a plain link's app finds the profile itself, and Back leaves the editor for home", async () => {
  profileUpdated.mockReturnValueOnce(false);
  const user = userEvent.setup();
  mount({ status: "edit", publicKeyZ32: KEY });
  await user.click(await screen.findByRole("button", { name: "Save" }));
  expect(await screen.findByRole("heading", { name: "Profile updated." })).toBeInTheDocument();
  expect(
    screen.getByText("Return to the app: it shows your new profile once it reads it again."),
  ).toBeInTheDocument();
  cleanup();
  mount({ status: "edit", publicKeyZ32: KEY });
  await screen.findByLabelText("Name");
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  expect(save).toHaveBeenCalledOnce();
});

it("connects the keychain for exactly the linked key when its identity is in Pubky Ring", async () => {
  state.catalog = {
    activePublicKeyZ32: KEY,
    identities: [{ publicIdentity: { publicKeyZ32: KEY }, keySource: "ring" }],
  };
  const ring = ringConnection();
  mount({ status: "edit", publicKeyZ32: KEY }, ring);
  expect(
    await screen.findByRole("heading", { name: "Connect your keychain." }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(ring.start).toHaveBeenCalledWith(expect.objectContaining({ expectedKey: KEY })),
  );
  expect(screen.queryByText(/not saved in this Passport/u)).toBeNull();
});

it("explains a key this Passport does not hold and offers only connecting that key", async () => {
  state.catalog = {
    activePublicKeyZ32: OTHER,
    identities: [{ publicIdentity: { publicKeyZ32: OTHER }, profile: { name: "Other" } }],
  };
  const ring = ringConnection();
  const user = userEvent.setup();
  mount({ status: "edit", publicKeyZ32: KEY }, ring);
  expect(
    await screen.findByRole("heading", { name: "Connect your keychain." }),
  ).toBeInTheDocument();
  expect(screen.getByText(/This pubky is not saved in this Passport/u)).toBeInTheDocument();
  await waitFor(() =>
    expect(ring.start).toHaveBeenCalledWith(expect.objectContaining({ expectedKey: KEY })),
  );
  // Nothing opens an editor: not the other identity's, not this key's.
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(load).not.toHaveBeenCalledWith(KEY);
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it("shows an invalid link as such, with the way to Passport", async () => {
  const user = userEvent.setup();
  mount({ status: "invalid" });
  expect(
    await screen.findByRole("heading", { name: "Invalid profile link." }),
  ).toHaveAccessibleDescription(/^This link can't be used to edit a profile\./u);
  expect(screen.queryByLabelText("Name")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Go to Passport" }));
  expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});
