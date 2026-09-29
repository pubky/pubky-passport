/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import { LocalAccountDraftRepository } from "@/client/logic/local-account/LocalAccountDraftRepository";
import type { LocalAccountRegistrationProgress } from "@/client/logic/local-account/LocalAccountSetupController";
import { PUBKY_SECRET_KEY_FORMAT } from "@/client/logic/pubky/pubkyIdentityKey";
import { fakeLocalIdentityController } from "@test-utils/fakeLocalIdentityController";
import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { expectResultOk } from "@test-utils/resultAssertions";
import type { PassportCollaborators } from "@/client/ui/passportCollaborators";
import type { PassportProvider } from "@/libs/passportProvider";
import { UniversalSignerFlow } from "./universalSignerFlow";

const LOCAL = vi.hoisted(() => ({
  importBackup: vi.fn(),
  registerAccount: vi.fn(),
  verifyBackup: vi.fn(),
  dispose: vi.fn(),
}));
const ADDED = { publicIdentity: { publicKeyZ32: "new-identity" } };
const EXISTING = { publicIdentity: { publicKeyZ32: "existing-identity" } };
const HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";
const DRAFT_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const EXACT_REQUEST =
  "pubkyauth://signin?secret=exact-original&relay=https%3A%2F%2Frelay.example%2Finbox";

// Account creation and import construct the setup controller themselves; only its SDK work is faked.
vi.mock("@/client/logic/local-account/LocalAccountSetupController", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/client/logic/local-account/LocalAccountSetupController")
  >()),
  LocalAccountSetupController: class {
    hasStartedRegistration = false;
    discardUnregistered() {
      return Result.ok();
    }
    abandonAccount() {
      return Result.ok();
    }
    prepareAccount() {
      return Result.ok(ADDED);
    }
    createBackup() {
      return Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "backup.pkarr" });
    }
    skipVerification() {
      return Result.ok();
    }
    verifyBackup = LOCAL.verifyBackup;
    returnToBackup() {
      return Result.ok();
    }
    registerAccount = LOCAL.registerAccount;
    dispose = LOCAL.dispose;
  },
}));
vi.mock("@/client/logic/backup/BackupImporter", () => ({
  BackupImporter: class {
    importBackup = LOCAL.importBackup;
    republishHomeserver = vi.fn();
    discardPending = vi.fn();
    dispose = LOCAL.dispose;
  },
}));

let state: { catalog: LocalIdentityCatalog; listener?: (() => void) | undefined };
const approve = vi.fn();
const cancel = vi.fn();
const finishExternalApproval = vi.fn();
const review = {
  authenticationMethod: "cookie",
  requesterName: "Original app",
  capabilities: [],
  callbackHost: "original.app",
} as const;

function mount(withRequest: boolean, collaborators: Partial<PassportCollaborators> = {}) {
  return render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      ...collaborators,
      createLocalIdentityController: () => fakeLocalIdentityController(state),
      createAuthorizationController: () =>
        fakePassportAuthorizationController(
          { current: withRequest ? { status: "review", review } : { status: "manual-entry" } },
          { approve, cancel, externalSignerUrl: () => EXACT_REQUEST, finishExternalApproval },
        ),
    }),
  );
}
/** Opens identity addition: from the request's identity list, or through the switcher. */
async function openAddition(user: ReturnType<typeof userEvent.setup>, withRequest: boolean) {
  if (withRequest) {
    await user.click(
      await screen.findByRole("button", { name: "Continue with Google or import a backup" }),
    );
    return;
  }
  await user.click(await screen.findByRole("button", { name: "Switch identity" }));
  await user.click(screen.getByRole("button", { name: "Add identity" }));
}
/** Opens account creation: from the request's identity list, or through the switcher. */
async function openAccountCreation(user: ReturnType<typeof userEvent.setup>, withRequest: boolean) {
  if (!withRequest) await openAddition(user, false);
  await user.click(await screen.findByRole("button", { name: "Create account" }));
}
/** A phone: Ring hand-offs lead with their deep link. */
function stubCoarsePointer() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
/** From the review, back to the list and on to the request's Ring hand-off. */
async function expectRingHandoff(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Switch identity" }));
  await user.click(screen.getByRole("button", { name: "Open in Pubky Ring" }));
  expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeInTheDocument();
}
function notifyAdded() {
  // Deliberately leave the older selection active: completion must select the new identity.
  state.catalog = {
    activePublicKeyZ32: EXISTING.publicIdentity.publicKeyZ32,
    identities: [EXISTING, ADDED],
  };
  state.listener?.();
}
function backupFile() {
  const file = new File([new Uint8Array([1, 2, 3])], "backup.pkarr", {
    type: "application/octet-stream",
  });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  return file;
}

beforeEach(() => {
  state = {
    catalog: { activePublicKeyZ32: EXISTING.publicIdentity.publicKeyZ32, identities: [EXISTING] },
  };
  LOCAL.verifyBackup.mockReturnValue(Result.ok());
  vi.stubGlobal("URL", URL);
  URL.createObjectURL = vi.fn(() => "blob:backup");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("shared addition navigation", () => {
  it("places account creation before backup import", async () => {
    state.catalog = { activePublicKeyZ32: null, identities: [] };
    mount(false);

    const create = await screen.findByRole("button", { name: "Create account" });
    const importBackup = screen.getByRole("button", { name: "Import backup" });
    expect(
      create.compareDocumentPosition(importBackup) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps a request's Create account on its list and the backup one quiet step away", async () => {
    state.catalog = { activePublicKeyZ32: null, identities: [] };
    const user = userEvent.setup();
    mount(true);

    expect(await screen.findByRole("button", { name: "Create account" })).toBeInTheDocument();
    await openAddition(user, true);
    // The focused step offers only what the list does not: Google and a backup.
    expect(screen.getByRole("button", { name: "Import backup" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pubky Ring/u })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in to Original app" })).toBeInTheDocument();
  });

  it.each([false, true])("returns import to its origin with request=%s", async (withRequest) => {
    const user = userEvent.setup();
    let finish!: () => void;
    LOCAL.importBackup.mockImplementation(
      () =>
        new Promise((resolve) => {
          notifyAdded();
          finish = () => resolve(Result.ok({ status: "imported", identity: ADDED }));
        }),
    );
    mount(withRequest);
    await openAddition(user, withRequest);
    await user.click(screen.getByRole("button", { name: "Import backup" }));
    await user.upload(screen.getByLabelText("Pubky backup"), backupFile());
    await user.type(screen.getByLabelText("Backup password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Import backup" }));
    expect(await screen.findByRole("heading", { name: "Import backup." })).toBeInTheDocument();
    expect(approve).not.toHaveBeenCalled();
    if (withRequest) expect(screen.getAllByLabelText("Signing in to original.app")).toHaveLength(1);
    await act(async () => finish());
    expect(
      await screen.findByRole("heading", {
        name: withRequest ? "Sign in to Original app" : "Your pubky.",
      }),
    ).toBeInTheDocument();
    expect(state.catalog.activePublicKeyZ32).toBe("new-identity");
    if (withRequest) await expectRingHandoff(user);
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "keeps local setup through backup verification and registration with request=%s, skip=%s",
    async (withRequest, skip) => {
      const user = userEvent.setup();
      let finish!: () => void;
      let progress!: (step: LocalAccountRegistrationProgress) => void;
      LOCAL.registerAccount.mockImplementation(
        (onProgress: typeof progress) =>
          new Promise((resolve) => {
            progress = onProgress;
            notifyAdded();
            finish = () => resolve(Result.ok(ADDED));
          }),
      );
      mount(withRequest);
      await openAccountCreation(user, withRequest);
      expect(
        screen.queryByRole("button", { name: "Continue with Google" }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Enter invite manually" }));
      await user.type(screen.getByLabelText("Enter invite code"), "AB12-CD34-EF56");
      await screen.findByText("Invite verified with the homeserver.");
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: /Keep in Passport/ }));
      await user.type(await screen.findByLabelText("Enter strong password"), "correct horse");
      await user.type(screen.getByLabelText("Confirm password"), "correct horse");
      await user.click(screen.getByRole("button", { name: "Download encrypted backup" }));
      act(notifyAdded);
      expect(screen.getByRole("heading", { name: "Verify backup." })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Use Pubky Ring/ })).not.toBeInTheDocument();
      expect(LOCAL.registerAccount).not.toHaveBeenCalled();
      if (skip) {
        await user.click(screen.getByRole("button", { name: "Skip this check (not recommended)" }));
        expect(LOCAL.verifyBackup).not.toHaveBeenCalled();
      } else {
        await user.upload(screen.getByLabelText("Backup file"), backupFile());
        await user.type(screen.getByLabelText("Backup password"), "correct horse");
        await user.click(screen.getByRole("button", { name: "Verify and create account" }));
      }
      expect(
        await screen.findByRole("heading", { name: "Setting up your pubky." }),
      ).toBeInTheDocument();
      expect(screen.getByText("Sign up to the homeserver").closest("li")).toHaveAttribute(
        "aria-current",
        "step",
      );
      act(() => progress("publishing"));
      expect(screen.getByText("Publish PKDNS records").closest("li")).toHaveAttribute(
        "aria-current",
        "step",
      );
      expect(screen.getByText("Sign up to the homeserver").closest("li")).toHaveTextContent(
        "complete",
      );
      act(() => progress("activating"));
      expect(screen.getByText("Activate identity").closest("li")).toHaveAttribute(
        "aria-current",
        "step",
      );
      await act(async () => finish());
      expect(
        await screen.findByRole("heading", {
          name: withRequest ? "Sign in to Original app" : "Your pubky.",
        }),
      ).toBeInTheDocument();
      expect(state.catalog.activePublicKeyZ32).toBe("new-identity");
      expect(approve).not.toHaveBeenCalled();
      if (withRequest) await expectRingHandoff(user);
    },
  );

  it.each([false, true])(
    "asks for the profile once after creation, and Finish later goes on to where the person was going, request=%s",
    async (withRequest) => {
      const user = userEvent.setup();
      const created = { ...ADDED, profileSetupRequired: true as const };
      LOCAL.registerAccount.mockImplementation(async () => {
        state.catalog = {
          activePublicKeyZ32: EXISTING.publicIdentity.publicKeyZ32,
          identities: [EXISTING, created],
        };
        state.listener?.();
        return Result.ok(created);
      });
      mount(withRequest);
      await openAccountCreation(user, withRequest);
      await user.click(screen.getByRole("button", { name: "Enter invite manually" }));
      await user.type(screen.getByLabelText("Enter invite code"), "AB12-CD34-EF56");
      await screen.findByText("Invite verified with the homeserver.");
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: /Keep in Passport/ }));
      await user.type(await screen.findByLabelText("Enter strong password"), "correct horse");
      await user.type(screen.getByLabelText("Confirm password"), "correct horse");
      await user.click(screen.getByRole("button", { name: "Download encrypted backup" }));
      await user.click(screen.getByRole("button", { name: "Skip this check (not recommended)" }));

      expect(
        await screen.findByRole("heading", { name: "Create your profile." }),
      ).toBeInTheDocument();
      // Finish later is the one way on without a profile; there is no Back into creation.
      expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Finish later" }));

      // Neither a backup detour nor Manage: the request's review, or the overview.
      expect(
        await screen.findByRole("heading", {
          name: withRequest ? "Sign in to Original app" : "Your pubky.",
        }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Choose backup method" })).toBeNull();
      if (withRequest) expect(screen.getByRole("button", { name: "Authorize" })).toBeEnabled();
      else expect(screen.getByRole("button", { name: "Set up profile" })).toBeInTheDocument();
      expect(state.catalog.activePublicKeyZ32).toBe("new-identity");
      expect(cancel).not.toHaveBeenCalled();
    },
  );

  it("backs out of import and add to the originating list", async () => {
    const user = userEvent.setup();
    mount(true);
    await openAddition(user, true);
    await user.click(screen.getByRole("button", { name: "Import backup" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("region", { name: "Other ways to sign in" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Sign in to Original app" })).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Choose the identity to sign in with." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("account creation navigation", () => {
  function saveDraft({ registrationStarted = false } = {}) {
    const drafts = new LocalAccountDraftRepository();
    expectResultOk(
      drafts.create(
        {
          publicIdentity: { publicKeyZ32: DRAFT_KEY },
          invite: { homeserverPubky: HOMESERVER, signupToken: "saved-invite" },
          step: "password",
        },
        { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT },
      ),
    );
    if (registrationStarted) expectResultOk(drafts.markRegistrationStarted(DRAFT_KEY));
  }

  async function openAccountCreation(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Switch identity" }));
    await user.click(screen.getByRole("button", { name: "Add identity" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));
  }

  it("does not force an unsubmitted saved setup and reopens it at the signer choice", async () => {
    saveDraft();
    const user = userEvent.setup();
    mount(false);

    expect(await screen.findByRole("button", { name: "Switch identity" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Choose your signer." })).not.toBeInTheDocument();
    await openAccountCreation(user);

    expect(screen.getByRole("heading", { name: "Choose your signer." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Protect your key." })).not.toBeInTheDocument();
  });

  it("keeps a resumed invite for Ring after backing out of Passport", async () => {
    saveDraft();
    stubCoarsePointer();
    const user = userEvent.setup();
    mount(false);
    await openAccountCreation(user);

    await user.click(screen.getByRole("button", { name: /Keep in Passport/ }));
    expect(await screen.findByRole("heading", { name: "Protect your key." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Choose your signer." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Use Pubky Ring/ }));

    const ring = screen.getByRole("link", { name: /Continue with Pubky Ring/ });
    expect(new URL(ring.getAttribute("href")!).searchParams.get("st")).toBe("saved-invite");
  });

  it("resumes a submitted setup on load and keeps Ring closed for its invite", async () => {
    saveDraft({ registrationStarted: true });
    mount(false);

    expect(await screen.findByRole("heading", { name: "Choose your signer." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Use Pubky Ring/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Keep in Passport/ })).toBeEnabled();
  });

  /** Submits a manual invite with a Passport key, then drops the key after sign-in fails. */
  async function abandonSubmittedInvite(
    user: ReturnType<typeof userEvent.setup>,
    status: Awaited<ReturnType<PassportCollaborators["checkSignupToken"]>>,
  ) {
    const checkSignupToken = vi
      .fn<PassportCollaborators["checkSignupToken"]>()
      .mockResolvedValue("valid");
    LOCAL.registerAccount.mockImplementation(async function (this: {
      hasStartedRegistration: boolean;
    }) {
      this.hasStartedRegistration = true;
      return Result.err({ code: "signin_failed" });
    });
    mount(false, { checkSignupToken });
    await openAccountCreation(user);
    await user.click(screen.getByRole("button", { name: "Enter invite manually" }));
    await user.type(screen.getByLabelText("Enter invite code"), "AB12-CD34-EF56");
    await screen.findByText("Invite verified with the homeserver.");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Keep in Passport/ }));
    await user.type(await screen.findByLabelText("Enter strong password"), "correct horse");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Download encrypted backup" }));
    await user.click(screen.getByRole("button", { name: "Skip this check (not recommended)" }));
    await user.click(await screen.findByRole("button", { name: "Start over" }));
    await user.type(screen.getByRole("textbox", { name: "Type DELETE to confirm" }), "DELETE");
    checkSignupToken.mockResolvedValue(status);
    await user.click(screen.getByRole("button", { name: "Remove key and start over" }));
    await vi.waitFor(() =>
      expect(checkSignupToken).toHaveBeenLastCalledWith(
        { homeserverPubky: HOMESERVER, signupToken: "AB12-CD34-EF56" },
        expect.any(AbortSignal),
      ),
    );
    return checkSignupToken;
  }

  it.each([
    ["used", false],
    ["not_found", false],
    ["valid", true],
    ["unknown", true],
  ] as const)(
    "rechecks a submitted invite after starting over and keeps it only if unused: %s",
    async (status, kept) => {
      const user = userEvent.setup();
      await abandonSubmittedInvite(user, status);

      if (kept) {
        await vi.waitFor(() =>
          expect(screen.getByRole("button", { name: /Use Pubky Ring/ })).toBeEnabled(),
        );
      } else {
        expect(
          await screen.findByRole("button", { name: "Enter invite manually" }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole("heading", { name: "Choose your signer." }),
        ).not.toBeInTheDocument();
      }
    },
  );

  it.each([
    ["Use Pubky Ring", /Use Pubky Ring/, "link", /Continue with Pubky Ring/],
    ["Keep in Passport", /Keep in Passport/, "heading", /Protect your key\./],
  ] as const)(
    "checks an invite again before %s reuses it when the check after starting over failed",
    async (_, signer, role, destination) => {
      stubCoarsePointer();
      const user = userEvent.setup();
      const checkSignupToken = await abandonSubmittedInvite(user, "unknown");
      await vi.waitFor(() => expect(screen.getByRole("button", { name: signer })).toBeEnabled());
      const checks = checkSignupToken.mock.calls.length;

      checkSignupToken.mockResolvedValueOnce("used");
      await user.click(screen.getByRole("button", { name: signer }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This invite has already been used.",
      );
      expect(screen.getByRole("heading", { name: "Choose your signer." })).toBeInTheDocument();

      checkSignupToken.mockResolvedValueOnce("valid");
      await user.click(screen.getByRole("button", { name: signer }));
      expect(await screen.findByRole(role, { name: destination })).toBeInTheDocument();
      expect(checkSignupToken).toHaveBeenCalledTimes(checks + 2);
    },
  );

  it("does not resume or remove a submitted setup whose identity is already saved", async () => {
    saveDraft({ registrationStarted: true });
    state.catalog = {
      activePublicKeyZ32: DRAFT_KEY,
      identities: [{ publicIdentity: { publicKeyZ32: DRAFT_KEY } }],
    };
    mount(false);

    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    // Rendering only reads the draft; account setup releases it when it next opens.
    expect(expectResultOk(new LocalAccountDraftRepository().read())?.registrationStarted).toBe(
      true,
    );
  });

  it("reads the unfinished account through the collaborator", async () => {
    const readAccountDraft = vi.fn<PassportCollaborators["readAccountDraft"]>(() =>
      Result.ok({
        publicIdentity: { publicKeyZ32: DRAFT_KEY },
        invite: { homeserverPubky: HOMESERVER, signupToken: "saved-invite" },
        step: "password",
        registrationStarted: true,
      }),
    );
    mount(false, { readAccountDraft });

    // The shell resumes account creation; the setup flow reads its own saved state.
    expect(
      await screen.findByRole("heading", { name: "Create your account." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch identity" })).not.toBeInTheDocument();
    expect(readAccountDraft).toHaveBeenCalledOnce();
  });

  it("rechecks an invite shown to Ring before Passport reuses it", async () => {
    const checkSignupToken = vi
      .fn<PassportCollaborators["checkSignupToken"]>()
      .mockResolvedValueOnce("valid")
      .mockResolvedValue("used");
    const user = userEvent.setup();
    mount(false, { checkSignupToken });
    await openAccountCreation(user);
    await user.click(screen.getByRole("button", { name: "Enter invite manually" }));
    await user.type(screen.getByLabelText("Enter invite code"), "AB12-CD34-EF56");
    await screen.findByText("Invite verified with the homeserver.");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Use Pubky Ring/ }));
    await user.click(screen.getByRole("button", { name: "Back" }));

    await user.click(screen.getByRole("button", { name: /Keep in Passport/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Pubky Ring has already used this invite.",
    );
    expect(screen.getByRole("heading", { name: "Choose your signer." })).toBeInTheDocument();
    expect(checkSignupToken).toHaveBeenCalledTimes(2);
  });
});

describe("provider homeserver", () => {
  const INSTANCE_WITHOUT_HOMESERVER = makeInstanceConfig({
    features: { google: false },
    homeserver: null,
  });

  function mountInstance(instance: PassportProvider) {
    const republishHomeserver = vi.fn(async (_publicKeyZ32: string, homeserverPubky: string) =>
      Result.ok(homeserverPubky),
    );
    render(
      withPassportTestProviders(
        <UniversalSignerFlow />,
        {
          createLocalIdentityController: () =>
            fakeLocalIdentityController(state, { republishHomeserver }),
          createAuthorizationController: () =>
            fakePassportAuthorizationController({ current: { status: "manual-entry" } }),
        },
        instance,
      ),
    );
    return { republishHomeserver, user: userEvent.setup() };
  }

  it("republishes a missing record to the configured provider homeserver", async () => {
    const { republishHomeserver, user } = mountInstance(makeInstanceConfig());
    await user.click(await screen.findByRole("button", { name: "Manage identity" }));
    await user.click(await screen.findByRole("button", { name: "Republish homeserver" }));
    await user.click(screen.getByRole("button", { name: "Publish record" }));

    expect(republishHomeserver).toHaveBeenCalledWith("existing-identity", HOMESERVER);
  });

  it("offers neither republishing nor Google without a provider homeserver or Google", async () => {
    const { republishHomeserver, user } = mountInstance(INSTANCE_WITHOUT_HOMESERVER);
    await user.click(await screen.findByRole("button", { name: "Manage identity" }));

    expect(await screen.findByText("No record found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Republish homeserver" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach to Google" })).not.toBeInTheDocument();
    expect(republishHomeserver).not.toHaveBeenCalled();
  });

  async function openManualInvite(instance: PassportProvider) {
    const { user } = mountInstance(instance);
    await user.click(await screen.findByRole("button", { name: "Switch identity" }));
    await user.click(screen.getByRole("button", { name: "Add identity" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await user.click(screen.getByRole("button", { name: "Enter invite manually" }));
  }

  it("prefills manual invites with the configured provider homeserver", async () => {
    await openManualInvite(makeInstanceConfig());

    expect(screen.getByText(HOMESERVER)).toHaveAttribute("id", "invite-homeserver");
    expect(screen.getByRole("button", { name: "Change homeserver" })).toBeInTheDocument();
  });

  it("asks for the homeserver of a manual invite when the provider has none", async () => {
    await openManualInvite(INSTANCE_WITHOUT_HOMESERVER);

    expect(screen.getByPlaceholderText("Homeserver public key")).toHaveValue("");
  });
});

describe("required Ring profile setup", () => {
  const RING: LocalIdentityMetadata = {
    publicIdentity: { publicKeyZ32: "ring-identity" },
    keySource: "ring",
    profileSetupRequired: true,
  };
  function disconnectedRing() {
    return {
      start: vi.fn(async () => Result.ok()),
      poll: vi.fn(() => new Promise<never>(() => undefined)),
      confirm: vi.fn(),
      authorizationUrl: () => "pubkyauth://signin?secret=passport-profile-only",
      isConnected: () => false,
      save: vi.fn(),
      dispose: vi.fn(),
    };
  }

  it("opens an app's request before Passport's own Ring request for unfinished setup", async () => {
    state.catalog = { activePublicKeyZ32: "ring-identity", identities: [RING] };
    const ring = disconnectedRing();
    const user = userEvent.setup();
    stubCoarsePointer();
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign });
    mount(true, { createRingProfileController: () => ring });

    expect(
      await screen.findByRole("heading", { name: "Sign in to Original app" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Connect your Ring." })).toBeNull();
    expect(screen.queryByRole("img", { name: "Pubky Ring profile connection QR code" })).toBeNull();
    expect(ring.start).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Key in Pubky Ring/u }));
    await user.click(screen.getByRole("button", { name: "Continue in Pubky Ring" }));
    // A phone follows the unchanged request straight to Ring.
    expect(assign).toHaveBeenCalledWith(EXACT_REQUEST);
    expect(screen.getByRole("link", { name: "Opening Pubky Ring…" })).toHaveAttribute(
      "href",
      EXACT_REQUEST,
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(approve).not.toHaveBeenCalled();
    expect(ring.start).not.toHaveBeenCalled();
    expect(state.catalog.identities[0]?.profileSetupRequired).toBe(true);
  });

  it("offers a reloaded Ring identity its setup without forcing the connection", async () => {
    state.catalog = { activePublicKeyZ32: "ring-identity", identities: [RING] };
    const user = userEvent.setup();
    mount(false, { createRingProfileController: disconnectedRing });

    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set up profile" }));
    expect(await screen.findByRole("heading", { name: "Connect your Ring." })).toBeInTheDocument();
    // Opened from the overview, Back is the one way out and returns there.
    expect(screen.queryByRole("button", { name: "Finish later" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    // Opened from Manage, Back returns to Manage.
    await user.click(screen.getByRole("button", { name: "Manage identity" }));
    const manage = screen.getByRole("heading", { level: 1 }).textContent;
    await user.click(screen.getByRole("button", { name: "Set up profile" }));
    expect(await screen.findByRole("heading", { name: "Connect your Ring." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(manage!);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });
});
