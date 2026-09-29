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

it.each([false, true])(
  "resumes unfinished profile and stays until a successful Finish, request=%s",
  async (request) => {
    const user = userEvent.setup();
    const mounted = mount(request);
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.type(screen.getByLabelText("Bio"), "Bitcoin");
    await user.type(screen.getByLabelText("X (Twitter)"), "@satoshi");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your profile");
    expect(screen.getByLabelText("Name")).toHaveValue("Satoshi");
    expect(approve).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      KEY,
      expect.objectContaining({ links: [{ title: "X (Twitter)", url: "https://x.com/satoshi" }] }),
      undefined,
    );
    mounted.unmount();
    mount(request);
    expect(
      await screen.findByRole("heading", { name: "Create your profile." }),
    ).toBeInTheDocument();
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
    expect(
      await screen.findByRole("heading", {
        name: request ? "Sign in to Original app" : "Your pubky.",
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Satoshi")).toBeInTheDocument();
    expect(approve).not.toHaveBeenCalled();
    if (request) {
      expect(screen.getAllByLabelText("Signing in to original.app")).toHaveLength(1);
      // Ring is offered on the review only, never inside the identity switcher.
      await user.click(screen.getByRole("button", { name: "Switch identity" }));
      expect(screen.queryByRole("button", { name: "Use Pubky Ring" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Back" }));
      await user.click(screen.getByRole("button", { name: "Use Pubky Ring" }));
      expect(screen.getByRole("link", { name: "Open in Ring" })).toHaveAttribute(
        "href",
        EXACT_REQUEST,
      );
    }
  },
);
it.each([false, true])(
  "lets the user finish required setup later without losing the requirement, request=%s",
  async (request) => {
    const user = userEvent.setup();
    mount(request);
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("button", { name: "Finish later" }));
    expect(
      await screen.findByRole("heading", {
        name: request ? "Sign in to Original app" : "Your pubky.",
      }),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    if (request) return;
    expect(screen.getByText(/profile isn't set up yet/u)).toHaveAttribute("role", "status");
    await user.click(screen.getByRole("button", { name: "Manage identity" }));
    await user.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(
      await screen.findByRole("heading", { name: "Create your profile." }),
    ).toBeInTheDocument();
    // Cancelling out of the editor no longer forces it back open.
    await user.click(screen.getByRole("button", { name: "Finish later" }));
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  },
);
it("preserves entered profile fields through Back and backup methods", async () => {
  const user = userEvent.setup();
  mount();
  await user.type(await screen.findByLabelText("Name"), "Satoshi");
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "Choose backup method" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Continue to profile" }));
  expect(screen.getByLabelText("Name")).toHaveValue("Satoshi");
  expect(save).not.toHaveBeenCalled();
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
  mount(true);
  expect(await screen.findByText("Satoshi")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Authorize" })).toBeEnabled();
  expect(approve).not.toHaveBeenCalled();
});
it("reads only the active identity's profile until the switcher lists them all", async () => {
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
  mount(true);
  expect(await screen.findByText("Satoshi")).toBeInTheDocument();
  expect(load.mock.calls).toEqual([[KEY]]);
  await user.click(screen.getByRole("button", { name: "Switch identity" }));
  expect(await screen.findByRole("button", { name: /Pseudonym/ })).toBeInTheDocument();
  expect(load.mock.calls).toEqual([[KEY], [other]]);
});
