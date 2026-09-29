/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UniversalSignerFlow } from "@/client/ui/universal-signer/universalSignerFlow";
import { fakeLocalIdentityController } from "@test-utils/fakeLocalIdentityController";
import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const EXACT_REQUEST = "pubkyauth://signin?secret=original&relay=https://relay.example/inbox";
const profile = { name: "Satoshi", bio: "Bitcoin", links: [], image: null, status: "busy" };
const load = vi.fn();
const save = vi.fn();
const approve = vi.fn();
let state: { catalog: LocalIdentityCatalog; listener?: (() => void) | undefined };

function mount(request = false) {
  return render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      createLocalIdentityController: () => fakeLocalIdentityController(state),
      createProfileController: () => ({ load, save }),
      createAuthorizationController: () =>
        fakePassportAuthorizationController(
          {
            current: request
              ? {
                  status: "review",
                  review: {
                    capabilities: [],
                    authenticationMethod: "cookie",
                    requesterName: "Original app",
                    callbackHost: "original.app",
                  },
                }
              : { status: "manual-entry" },
          },
          { approve, externalSignerUrl: () => EXACT_REQUEST },
        ),
    }),
  );
}
beforeEach(() => {
  state = {
    catalog: {
      activePublicKeyZ32: KEY,
      identities: [{ publicIdentity: { publicKeyZ32: KEY }, profileSetupRequired: true }],
    },
  };
  load.mockResolvedValue(Result.ok(null));
  save.mockResolvedValue(Result.err({ code: "save_failed" }));
});
afterEach(() => {
  cleanup();
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  vi.clearAllMocks();
});

it("offers unfinished profile setup from the overview and never forces it", async () => {
  const user = userEvent.setup();
  const mounted = mount();
  expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  // The overview also warns about the unprotected key, so the reminder is found by its text.
  expect(screen.getByText("Your public profile isn't set up yet.")).toHaveAttribute(
    "role",
    "status",
  );
  await user.click(screen.getByRole("button", { name: "Set up profile" }));
  await user.type(await screen.findByLabelText("Name"), "Satoshi");
  await user.type(screen.getByLabelText("Bio"), "Bitcoin");
  await user.type(screen.getByLabelText("X (Twitter)"), "@satoshi");
  await user.click(screen.getByRole("button", { name: "Finish" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your profile");
  expect(screen.getByLabelText("Name")).toHaveValue("Satoshi");
  expect(save).toHaveBeenCalledWith(
    KEY,
    expect.objectContaining({ links: [{ title: "X (Twitter)", url: "https://x.com/satoshi" }] }),
    undefined,
  );
  mounted.unmount();
  // A new visit opens on the overview again; the profile is asked for only once, after creation.
  mount();
  expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Create your profile." })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Set up profile" }));
  await user.type(await screen.findByLabelText("Name"), "Satoshi");
  let publish!: () => void;
  save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        publish = () => {
          state.catalog = {
            ...state.catalog,
            identities: [{ publicIdentity: { publicKeyZ32: KEY } }],
          };
          state.listener?.();
          // Publication is authoritative even if the follow-up public read is offline.
          load.mockResolvedValue(Result.err({ code: "load_failed" }));
          resolve(Result.ok(profile));
        };
      }),
  );
  await user.click(screen.getByRole("button", { name: "Finish" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  await act(async () => publish());
  expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  expect(await screen.findByText("Satoshi")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Set up profile" })).not.toBeInTheDocument();
  expect(approve).not.toHaveBeenCalled();
}, 15_000);
it("goes straight to the request's review for an identity without a profile", async () => {
  const user = userEvent.setup();
  mount(true);
  await user.click(await screen.findByRole("button", { name: /Your Pubky/u }));

  expect(await screen.findByRole("button", { name: "Authorize" })).toBeEnabled();
  expect(screen.getByRole("heading", { name: "Sign in to Original app" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Create your profile." })).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});
it("returns setup opened from the overview or Manage to where it was opened, keeping the reminder", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Set up profile" }));
  await user.type(await screen.findByLabelText("Name"), "Satoshi");
  // Opened later, Back is the one way out; Finish later belongs to the step after creation.
  expect(screen.queryByRole("button", { name: "Finish later" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back" }));
  // Back never detours through backups or Manage.
  expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Choose backup method" })).not.toBeInTheDocument();
  expect(screen.getByText(/profile isn't set up yet/u)).toHaveAttribute("role", "status");

  await user.click(screen.getByRole("button", { name: "Manage identity" }));
  const manage = screen.getByRole("heading", { level: 1 }).textContent;
  await user.click(screen.getByRole("button", { name: "Set up profile" }));
  expect(await screen.findByRole("heading", { name: "Create your profile." })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Finish later" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(manage!);
  expect(screen.getByRole("button", { name: "Set up profile" })).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  expect(approve).not.toHaveBeenCalled();
});
it("keeps the first two saved custom link titles editable", async () => {
  load.mockResolvedValue(
    Result.ok({
      profile: {
        ...profile,
        links: [
          { title: "My blog", url: "https://blog.example/" },
          { title: "Projects", url: "https://projects.example/" },
        ],
      },
    }),
  );
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Set up profile" }));
  const firstTitle = await screen.findByRole("textbox", { name: "Link 1 title" });
  const secondTitle = screen.getByRole("textbox", { name: "Link 2 title" });
  await user.clear(firstTitle);
  await user.type(firstTitle, "Writing");
  await user.clear(secondTitle);
  await user.type(secondTitle, "Code");
  await user.click(screen.getByRole("button", { name: "Finish" }));
  expect(save).toHaveBeenCalledWith(
    KEY,
    expect.objectContaining({
      links: [
        { title: "Writing", url: "https://blog.example/" },
        { title: "Code", url: "https://projects.example/" },
      ],
    }),
    undefined,
  );
});
it("does not offer Finish when a profile read fails and retries without overwriting", async () => {
  load.mockResolvedValue(Result.err({ code: "load_failed" }));
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Set up profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your profile");
  expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
  load.mockResolvedValue(Result.ok({ profile }));
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("Name")).toHaveValue("Satoshi");
  expect(save).not.toHaveBeenCalled();
});
it("shows existing public profiles on overview, switcher and authorization, with Google association retained", async () => {
  state.catalog = {
    activePublicKeyZ32: KEY,
    identities: [
      {
        publicIdentity: { publicKeyZ32: KEY },
        googleAccount: {
          name: "Google name",
          email: "google@example.com",
          googleSubject: "google-subject",
          pictureUrl: null,
        },
      },
    ],
  };
  load.mockResolvedValue(Result.ok({ profile }));
  const user = userEvent.setup();
  const mounted = mount();
  expect(await screen.findByRole("heading", { name: "Satoshi" })).toBeInTheDocument();
  expect(screen.getByText("google@example.com")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Switch identity" }));
  expect(screen.getByRole("button", { name: /Satoshi/ })).toBeInTheDocument();
  mounted.unmount();
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  // The request's list names the identity from the summary kept by that read.
  state.catalog = {
    ...state.catalog,
    identities: state.catalog.identities.map((identity) => ({
      ...identity,
      profileSummary: { name: "Satoshi" },
    })),
  };
  mount(true);
  await user.click(await screen.findByRole("button", { name: /Satoshi/u }));
  expect(screen.getByRole("button", { name: "Authorize" })).toBeEnabled();
  expect(await screen.findByText("Satoshi")).toBeInTheDocument();
  expect(
    screen.getByRole("group", { name: "Attached Google account: google@example.com" }),
  ).toBeInTheDocument();
  expect(approve).not.toHaveBeenCalled();
});
it("reads only the active identity's profile until the switcher shows them all", async () => {
  const other = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
  state.catalog = {
    activePublicKeyZ32: KEY,
    identities: [
      { publicIdentity: { publicKeyZ32: KEY } },
      { publicIdentity: { publicKeyZ32: other } },
    ],
  };
  load.mockImplementation(async (key: string) =>
    Result.ok({ profile: { name: key === KEY ? "Satoshi" : "Pseudonym" } }),
  );
  const user = userEvent.setup();
  const mounted = mount();
  expect(await screen.findByText("Satoshi")).toBeInTheDocument();
  expect(load.mock.calls).toEqual([[KEY]]);
  await user.click(screen.getByRole("button", { name: "Switch identity" }));
  expect(await screen.findByRole("button", { name: /Pseudonym/ })).toBeInTheDocument();
  expect(load.mock.calls).toEqual([[KEY], [other]]);
  mounted.unmount();
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  load.mockClear();
  // A request's list reads no profile: it names identities from the summaries kept by earlier
  // reads, and only the identity chosen for the review is read.
  state.catalog = {
    activePublicKeyZ32: KEY,
    identities: [
      { publicIdentity: { publicKeyZ32: KEY }, profileSummary: { name: "Remembered" } },
      { publicIdentity: { publicKeyZ32: other } },
    ],
  };
  mount(true);
  expect(await screen.findByRole("button", { name: /Remembered/ })).toBeInTheDocument();
  const unnamed = screen.getByRole("button", { name: /Your Pubky/ });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(load).not.toHaveBeenCalled();
  await user.click(unnamed);
  expect(await screen.findByRole("button", { name: "Authorize" })).toBeInTheDocument();
  expect(await screen.findByText("Pseudonym")).toBeInTheDocument();
  expect(load.mock.calls).toEqual([[other]]);
});
