/** @vitest-environment jsdom */

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "@test-utils/MemoryStorage";
import { expectResultOk } from "@test-utils/resultAssertions";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import {
  HomegateSignupController,
  type Scheduler,
} from "@/client/logic/homegate/HomegateSignupController";
import { HomegateSignupRepository } from "@/client/logic/homegate/HomegateSignupRepository";
import type {
  HomegateVerificationFailure,
  LightningInvoice,
} from "@/client/logic/homegate/HomegateVerificationClient";
import { InviteDestinationController } from "@/client/logic/local-account/InviteDestinationController";
import { LocalAccountDraftRepository } from "@/client/logic/local-account/LocalAccountDraftRepository";
import { LocalStorageIdentityRepository } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkySecretKeyMaterial,
} from "@/client/logic/pubky/pubkyIdentityKey";
import type { SignupTokenStatus } from "@/client/logic/pubky/SignupTokenChecker";
import type { VerificationAvailability } from "@/client/logic/homegate/HomegateAvailabilityClient";
import { HomegateAvailabilityContext } from "@/client/ui/homegateAvailability";
import type {
  PassportCollaborators,
  RingProfileControllerPort,
} from "@/client/ui/passportCollaborators";
import type { LocalAccountSetupPort } from "@/client/ui/local-account/localAccountCreationFlow";
import { CreateAccountFlow } from "./createAccountFlow";

const HOMESERVER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const INVITE = { homeserverPubky: HOMESERVER, signupToken: "SMS1-NV1T-E000" };
const INVOICE: LightningInvoice = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  amountSat: 100,
  bolt11Invoice: "lnbc100n1example",
  expiresAt: Date.now() + 600_000,
};

const LOCAL_KEY = "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy";
const RING_IDENTITY: LocalIdentityMetadata = {
  publicIdentity: { publicKeyZ32: "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy" },
  keySource: "ring",
  profileSetupRequired: true,
};

type Answer<T> = Result<T, HomegateVerificationFailure>;

/**
 * The setup of a key kept in this browser whose invite the homeserver refuses. Only its SDK
 * work is faked; the flow around it is the real one.
 */
function refusingSetupController(): LocalAccountSetupPort {
  const controller = {
    hasStartedRegistration: false,
    preparedStep: "password" as const,
    prepareAccount: () => Result.ok({ publicIdentity: { publicKeyZ32: LOCAL_KEY } }),
    createBackup: () =>
      Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: `pubky-${LOCAL_KEY}.pkarr` }),
    verifyBackup: () => Result.ok({ publicIdentity: { publicKeyZ32: LOCAL_KEY } }),
    skipVerification: () => Result.ok(),
    returnToBackup: () => Result.ok(),
    discardUnregistered: () => Result.ok(),
    abandonAccount: () => Result.ok(),
    registerAccount: async () => {
      controller.hasStartedRegistration = true;
      return Result.err({ code: "invite_rejected" as const });
    },
    dispose: () => undefined,
  };
  return controller;
}

/** A Ring profile connection that Ring approves straight away, pending the person's confirmation. */
function approvingRingProfile() {
  return {
    start: vi.fn(async () => Result.ok()),
    poll: vi.fn(async () =>
      Result.ok({
        status: "approved",
        publicKeyZ32: RING_IDENTITY.publicIdentity.publicKeyZ32,
        hasProfile: "none",
      }),
    ),
    confirm: vi.fn(async () => Result.ok(RING_IDENTITY)),
    authorizationUrl: () => "pubkyauth://signin?secret=profile-only",
    isConnected: () => true,
    save: vi.fn(),
    dispose: vi.fn(),
  } as unknown as RingProfileControllerPort;
}

function fakeVerification() {
  return {
    sendSmsCode: vi.fn(async (): Promise<Answer<void>> => Result.ok()),
    verifySmsCode: vi.fn(async (): Promise<Answer<typeof INVITE>> => Result.ok(INVITE)),
    createLightningInvoice: vi.fn(async (): Promise<Answer<LightningInvoice>> =>
      Result.ok(INVOICE),
    ),
    checkLightningPayment: vi.fn(async (): Promise<Answer<typeof INVITE | null>> =>
      Result.err({ code: "network_failed" }),
    ),
  };
}

/** Records scheduled polls so a test can see whether they were cancelled. */
function manualScheduler() {
  const timers: { run: () => void; cancelled: boolean }[] = [];
  const schedule: Scheduler = (run) => {
    const timer = { run, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  return { schedule, timers };
}

function mountFlow(
  options: {
    storage?: MemoryStorage;
    status?: SignupTokenStatus;
    schedule?: Scheduler;
    ringProfile?: RingProfileControllerPort;
    methods?: VerificationAvailability;
    createSetupController?: () => LocalAccountSetupPort;
    savedSetup?: ConstructorParameters<typeof InviteDestinationController>[0];
  } = {},
) {
  const storage = options.storage ?? new MemoryStorage();
  const verification = fakeVerification();
  const checkSignupToken = vi.fn(async () => options.status ?? ("valid" as const));
  const collaborators: Partial<PassportCollaborators> = {
    checkSignupToken,
    createHomegateSignupController: () =>
      new HomegateSignupController(
        verification,
        new HomegateSignupRepository(() => storage),
        Date.now,
        options.schedule,
      ),
    createInviteDestinationController: (check) =>
      new InviteDestinationController(
        options.savedSetup ?? Result.ok(null),
        check,
        new LocalAccountDraftRepository(() => storage),
      ),
  };
  const onBack = vi.fn();
  const onLocalComplete = vi.fn();
  const flow = (
    <CreateAccountFlow
      inviteHomeserver={HOMESERVER}
      onBack={onBack}
      onLocalComplete={onLocalComplete}
      ringProfileController={options.ringProfile ?? ({} as RingProfileControllerPort)}
      createSetupController={options.createSetupController}
    />
  );
  const view = render(
    withPassportTestProviders(
      options.methods ? (
        <HomegateAvailabilityContext value={{ methods: options.methods, retry: vi.fn() }}>
          {flow}
        </HomegateAvailabilityContext>
      ) : (
        flow
      ),
      collaborators,
    ),
  );
  return { ...view, storage, verification, checkSignupToken, onBack, onLocalComplete };
}

function storedInvite() {
  const storage = new MemoryStorage();
  new HomegateSignupRepository(() => storage).saveInvite(INVITE);
  return storage;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Keeps the key in this browser and registers it once the recovery file was downloaded. */
async function registerInThisBrowser(user: ReturnType<typeof userEvent.setup>) {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  await user.click(screen.getByRole("button", { name: /Keep key in this browser/u }));
  await user.type(await screen.findByLabelText("Enter strong password"), "correct horse");
  await user.click(screen.getByRole("button", { name: "Download recovery file" }));
  await user.click(screen.getByRole("button", { name: "Skip this check (not recommended)" }));
}

async function verifyBySms(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Continue with SMS" }));
  await user.type(screen.getByLabelText("Phone number", { exact: true }), "+41791234567");
  await user.click(screen.getByRole("button", { name: "Send code" }));
  await user.type(screen.getByLabelText("Verification code", { exact: true }), "123456");
  await user.click(screen.getByRole("button", { name: "Verify code" }));
}

/** A phone: the Ring signup leads with its deep link, which carries the invite. */
function stubCoarsePointer() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe("CreateAccountFlow", () => {
  it("asks where the key should live and recommends Pubky Ring first", async () => {
    mountFlow({ storage: storedInvite() });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Where should your key live?" }),
    ).toBeVisible();
    // Verification is done; the account is not created until this step ends, so it is current.
    const steps = within(
      screen.getByRole("navigation", { name: "Account setup progress" }),
    ).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      "Completed: Verify",
      "2Account",
      "3Profile",
    ]);
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    const [ring, browser] = screen.getAllByRole("region");
    expect(ring).toHaveAccessibleName("Pubky Ring app");
    expect(within(ring!).getByText("Recommended")).toBeVisible();
    const keepInRing = within(ring!).getByRole("button", { name: "Keep key in Pubky Ring" });
    expect(keepInRing).toHaveClass("bg-brand/16");
    // Moving from button to button still says which one is recommended.
    expect(keepInRing).toHaveAccessibleDescription("Recommended");
    expect(browser).toHaveAccessibleName("This browser");
    expect(within(browser!).queryByText("Recommended")).toBeNull();
    const keepHere = within(browser!).getByRole("button", { name: "Keep key in this browser" });
    expect(keepHere).not.toHaveClass("bg-brand/16");
    expect(keepHere).not.toHaveAttribute("aria-describedby");
  });

  it("keeps a verified SMS invite through Back and offers it again without verifying", async () => {
    stubCoarsePointer();
    const user = userEvent.setup();
    const first = mountFlow();
    await user.click(screen.getByRole("button", { name: "Continue with SMS" }));
    await user.type(screen.getByLabelText("Phone number", { exact: true }), "+41791234567");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(screen.getByLabelText("Verification code", { exact: true }), "123456");
    await user.click(screen.getByRole("button", { name: "Verify code" }));
    expect(
      await screen.findByRole("heading", { name: "Where should your key live?" }),
    ).toBeVisible();

    // The verification that just worked says so before the choice; it was never an invite.
    expect(screen.getByText("Phone number verified.")).toHaveAttribute("role", "status");
    expect(screen.queryByText(/invite/iu)).toBeNull();
    // Leaving account creation is Back, not the Cancel that answers an app; it says the
    // verification is kept, and Discard verification is a side action after it.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByText("Your verification stays saved in this browser.")).toBeVisible();
    const discard = screen.getByRole("button", { name: "Discard verification" });
    expect(discard.closest('[data-slot="tertiary-actions"]')).not.toBeNull();
    const back = screen.getByRole("button", { name: "Back" });
    expect(back.compareDocumentPosition(discard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(back);
    expect(first.onBack).toHaveBeenCalledOnce();
    first.unmount();

    const second = mountFlow({ storage: first.storage });
    expect(screen.getByRole("heading", { name: "Where should your key live?" })).toBeVisible();
    // A verification from an earlier visit is welcomed back instead.
    expect(screen.queryByText("Phone number verified.")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Keep key in Pubky Ring/u }));
    const ring = screen.getByRole("link", { name: /Continue with Pubky Ring/u });
    expect(new URL(ring.getAttribute("href")!).searchParams.get("st")).toBe(INVITE.signupToken);
    expect(first.verification.sendSmsCode).toHaveBeenCalledOnce();
    expect(first.verification.verifySmsCode).toHaveBeenCalledOnce();
    expect(second.verification.verifySmsCode).not.toHaveBeenCalled();
  });

  it("uses the homeserver Homegate issued the invite for, not this Passport's", async () => {
    const issued = {
      homeserverPubky: "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo",
      signupToken: "SMS1-NV1T-E111",
    };
    const storage = new MemoryStorage();
    new HomegateSignupRepository(() => storage).saveInvite(issued);
    const setup = refusingSetupController();
    const prepareAccount = vi.spyOn(setup, "prepareAccount");
    const user = userEvent.setup();
    const { checkSignupToken } = mountFlow({ storage, createSetupController: () => setup });

    await screen.findByRole("heading", { name: "Where should your key live?" });
    // The choice names no homeserver; "Account created." does.
    expect(screen.queryByText("Homeserver")).toBeNull();
    expect(screen.queryByText(issued.homeserverPubky)).toBeNull();

    await user.click(screen.getByRole("button", { name: /Keep key in this browser/u }));
    await screen.findByLabelText("Enter strong password");
    expect(checkSignupToken).toHaveBeenCalledWith(issued, expect.any(AbortSignal));
    expect(prepareAccount).toHaveBeenCalledWith(issued);
  });

  it("welcomes back a verification restored from an earlier visit", async () => {
    mountFlow({ storage: storedInvite() });
    expect(
      await screen.findByText(/Welcome back\. Your verification is saved in this browser/u),
    ).toBeVisible();
    expect(screen.queryByText("Your verification stays saved in this browser.")).toBeNull();
  });

  it("opens on the invite entry where invites are the only method, and Back leaves", async () => {
    const user = userEvent.setup();
    const { onBack } = mountFlow({
      methods: {
        google: { status: "unavailable" },
        sms: { status: "unavailable" },
        lightning: { status: "unavailable" },
      },
    });
    expect(screen.getByRole("heading", { name: "Use an invite." })).toBeVisible();
    expect(screen.getByText(/Creating an account here needs an invite code/u)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Enter invite manually" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it.each([
    ["SMS is available", "available", "unavailable", true],
    ["only Lightning is available", "blocked", "available", true],
    ["SMS is blocked here and Lightning is not offered", "blocked", "unavailable", false],
    ["SMS could not be checked and Lightning is not offered", "unknown", "unavailable", false],
  ] as const)(
    "after a refused invite, offers another way only where one works: %s",
    async (_case, sms, lightning, offered) => {
      const user = userEvent.setup();
      mountFlow({
        status: "not_found",
        methods: {
          google: { status: "unavailable" },
          sms: { status: sms },
          lightning: { status: lightning },
        },
      });
      await user.click(screen.getByRole("button", { name: "Enter invite manually" }));
      await user.type(screen.getByLabelText("Enter invite code"), "AB12-CD34-EF56");
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This homeserver does not recognize this invite.",
      );
      expect(screen.queryByRole("button", { name: "Verify another way" }) !== null).toBe(offered);
    },
  );

  it("offers Lightning and an invite code once SMS refuses the number", async () => {
    const user = userEvent.setup();
    const { verification } = mountFlow();
    verification.sendSmsCode.mockResolvedValueOnce(Result.err({ code: "annual_limit_exceeded" }));
    await user.click(screen.getByRole("button", { name: "Continue with SMS" }));
    await user.type(screen.getByLabelText("Phone number", { exact: true }), "+41791234567");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("yearly sign-up limit");
    expect(screen.getByRole("button", { name: "Send code" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use an invite code" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Pay with Lightning instead" }));
    expect(await screen.findByText("100")).toHaveTextContent(/^100 sats$/u);
  });

  it("clears an expired code and unlocks Resend", async () => {
    const user = userEvent.setup();
    const { verification } = mountFlow();
    verification.verifySmsCode.mockResolvedValueOnce(Result.err({ code: "verification_expired" }));
    await user.click(screen.getByRole("button", { name: "Continue with SMS" }));
    await user.type(screen.getByLabelText("Phone number", { exact: true }), "+41791234567");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    const code = screen.getByLabelText("Verification code", { exact: true });
    await user.type(code, "000000");
    expect(screen.getByRole("button", { name: /^Resend \(\d+s\)$/u })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Send a new code to continue.");
    expect(code).toHaveValue("");
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Verify code" })).toBeDisabled();
  });

  it("discards a saved invite only after the person confirms it", async () => {
    const user = userEvent.setup();
    const { storage } = mountFlow({ storage: storedInvite() });

    await user.click(screen.getByRole("button", { name: "Discard verification" }));
    const dialog = screen.getByRole("dialog", { name: "Discard your verification?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(storage.length).toBe(1);
    expect(screen.getByRole("heading", { name: "Where should your key live?" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Discard verification" }));
    const confirmation = screen.getByRole("dialog", { name: "Discard your verification?" });
    await user.type(within(confirmation).getByLabelText(/Type DELETE/u), "DELETE");
    await user.click(within(confirmation).getByRole("button", { name: "Discard verification" }));

    expect(storage.length).toBe(0);
    expect(await screen.findByRole("heading", { name: /Create your/u })).toBeVisible();
  });

  it.each([
    ["used", "Pubky Ring has already used this invite.", 0],
    ["not_found", "This homeserver does not recognize this invite.", 1],
  ] as const)(
    "checks an invite restored from an earlier visit before Passport uses it (%s)",
    async (status, message, storedRecords) => {
      const user = userEvent.setup();
      const { checkSignupToken, storage } = mountFlow({ storage: storedInvite(), status });

      await user.click(screen.getByRole("button", { name: /Keep key in this browser/u }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(checkSignupToken).toHaveBeenCalledWith(INVITE, expect.any(AbortSignal));
      expect(screen.getByRole("heading", { name: "Where should your key live?" })).toBeVisible();
      // A used invite already belongs to an account, so the next visit does not offer it.
      expect(storage.length).toBe(storedRecords);
    },
  );

  it("takes a restored invite Ring already used straight to Ring's profile step", async () => {
    const user = userEvent.setup();
    const { checkSignupToken, storage, onLocalComplete } = mountFlow({
      storage: storedInvite(),
      status: "used",
      ringProfile: approvingRingProfile(),
    });

    await user.click(screen.getByRole("button", { name: /Keep key in Pubky Ring/u }));

    expect(await screen.findByRole("heading", { name: "Connect Pubky Ring." })).toBeVisible();
    expect(screen.queryByRole("img", { name: "Pubky Ring signup QR code" })).toBeNull();
    expect(checkSignupToken).toHaveBeenCalledWith(INVITE, expect.any(AbortSignal));
    expect(storage.length).toBe(0);
    // Passport cannot know which pubky Ring created, so the person confirms the connected one.
    expect(await screen.findByText(RING_IDENTITY.publicIdentity.publicKeyZ32)).toBeVisible();
    expect(onLocalComplete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Yes, it is my new pubky" }));
    expect(onLocalComplete).toHaveBeenCalledWith(RING_IDENTITY);
  });

  it("keeps a Lightning invoice when a different invite creates the account", async () => {
    const user = userEvent.setup();
    const { storage, onLocalComplete } = mountFlow({ ringProfile: approvingRingProfile() });
    await user.click(screen.getByRole("button", { name: "Continue with Lightning" }));
    expect(await screen.findByText("100")).toHaveTextContent(/^100 sats$/u);
    await user.click(screen.getByRole("button", { name: "Use an invite code" }));
    await user.click(screen.getByLabelText("Enter invite code"));
    await user.paste("AB12-CD34-EF56");
    await screen.findByText("Invite verified with the homeserver.");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Keep key in Pubky Ring/u }));
    await user.click(screen.getByRole("button", { name: "Continue to profile" }));
    await user.click(await screen.findByRole("button", { name: "Yes, it is my new pubky" }));

    expect(onLocalComplete).toHaveBeenCalledWith(RING_IDENTITY);
    expect(new HomegateSignupRepository(() => storage).read()).toEqual(
      Result.ok({ invoice: INVOICE }),
    );
  });

  it("says a Lightning payment was received before asking where the key lives", async () => {
    const user = userEvent.setup();
    const scheduler = manualScheduler();
    const { verification } = mountFlow({ schedule: scheduler.schedule });
    verification.checkLightningPayment.mockResolvedValue(Result.ok(INVITE));
    await user.click(screen.getByRole("button", { name: "Continue with Lightning" }));
    expect(await screen.findByText("100")).toHaveTextContent(/^100 sats$/u);

    await act(async () => scheduler.timers[0]?.run());

    expect(
      await screen.findByRole("heading", { name: "Where should your key live?" }),
    ).toBeVisible();
    expect(screen.getByText("Payment received. You’re verified.")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("shows a damaged saved setup at the account step, where that setup stopped", () => {
    mountFlow({ savedSetup: Result.err({ code: "invalid_draft" }) });

    expect(screen.getByRole("heading", { name: "Setup unavailable." })).toBeVisible();
    // Verification is behind any saved setup, so the stepper does not send the person back to it.
    const steps = within(
      screen.getByRole("navigation", { name: "Account setup progress" }),
    ).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      "Completed: Verify",
      "2Account",
      "3Profile",
    ]);
    expect(steps[1]).toHaveAttribute("aria-current", "step");
  });

  it("shows nothing as done when browser storage can't be read at all", () => {
    mountFlow({ savedSetup: Result.err({ code: "storage_unavailable" }) });

    expect(screen.getByRole("heading", { name: "Setup unavailable." })).toBeVisible();
    const steps = within(
      screen.getByRole("navigation", { name: "Account setup progress" }),
    ).getAllByRole("listitem");
    expect(steps[0]).toHaveAttribute("aria-current", "step");
    expect(steps[0]).not.toHaveTextContent(/Completed/u);
  });

  it("asks to verify again when the homeserver refuses the code a verification gave", async () => {
    const user = userEvent.setup();
    const { storage, verification } = mountFlow({ createSetupController: refusingSetupController });
    await verifyBySms(user);
    await registerInThisBrowser(user);

    expect(
      await screen.findByRole("heading", { name: "Verification not accepted." }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Verify again" }));

    // Back at the methods, which say why; the refused code is not kept for another try.
    expect(await screen.findByRole("heading", { name: /Create your/u })).toBeVisible();
    expect(
      screen.getByText(
        "Your previous verification couldn’t be used. Choose a method to verify again.",
      ),
    ).toBeVisible();
    expect(new HomegateSignupRepository(() => storage).read()).toEqual(Result.ok(null));
    // Said once: after choosing a method and coming back, the methods no longer repeat it.
    await user.click(screen.getByRole("button", { name: "Continue with SMS" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: /Create your/u })).toBeVisible();
    expect(screen.queryByText(/previous verification couldn’t be used/u)).toBeNull();
    expect(verification.verifySmsCode).toHaveBeenCalledOnce();
  });

  it("opens the invite entry for another code when the homeserver refuses an invite", async () => {
    const user = userEvent.setup();
    mountFlow({ createSetupController: refusingSetupController });
    await user.click(screen.getByRole("button", { name: "Enter invite manually" }));
    await user.type(screen.getByLabelText("Enter invite code"), "AB12-CD34-EF56");
    await screen.findByText("Invite verified with the homeserver.");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await registerInThisBrowser(user);

    expect(await screen.findByRole("heading", { name: "Invite not accepted." })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Enter a different invite" }));

    expect(await screen.findByRole("heading", { name: "Use an invite." })).toBeVisible();
    expect(screen.getByLabelText("Enter invite code")).toHaveValue("");
  });

  it("stops polling the invoice when the person switches to an invite code", async () => {
    const user = userEvent.setup();
    const scheduler = manualScheduler();
    const { verification } = mountFlow({ schedule: scheduler.schedule });
    await user.click(screen.getByRole("button", { name: "Continue with Lightning" }));
    expect(await screen.findByText("100")).toHaveTextContent(/^100 sats$/u);

    await act(async () => scheduler.timers[0]?.run());
    expect(await screen.findByText(/Could not reach the verification service/u)).toBeVisible();
    expect(scheduler.timers).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Use an invite code" }));

    expect(screen.getByLabelText("Enter invite code")).toBeVisible();
    expect(scheduler.timers[1]?.cancelled).toBe(true);
    expect(verification.checkLightningPayment).toHaveBeenCalledOnce();
  });
});

describe("CreateAccountFlow with a finished registration's draft", () => {
  const PUBLIC_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";

  function secretKey(): PubkySecretKeyMaterial {
    return { bytes: new Uint8Array(32).fill(1), format: PUBKY_SECRET_KEY_FORMAT };
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("releases the draft of a finished registration so Ring and a new invite stay usable", async () => {
    stubCoarsePointer();
    // Registration saved the key, but removing its draft afterwards failed.
    const drafts = new LocalAccountDraftRepository();
    expectResultOk(
      drafts.create(
        {
          publicIdentity: { publicKeyZ32: PUBLIC_KEY },
          invite: { homeserverPubky: HOMESERVER, signupToken: "RDMD-0000-0000" },
          step: "confirm",
        },
        secretKey(),
      ),
    );
    expectResultOk(drafts.markRegistrationStarted(PUBLIC_KEY));
    expectResultOk(
      new LocalStorageIdentityRepository().save(
        { publicIdentity: { publicKeyZ32: PUBLIC_KEY } },
        secretKey(),
      ),
    );
    const user = userEvent.setup();
    render(
      withPassportTestProviders(
        <CreateAccountFlow
          inviteHomeserver={HOMESERVER}
          onBack={vi.fn()}
          onLocalComplete={vi.fn()}
          ringProfileController={{} as RingProfileControllerPort}
        />,
      ),
    );

    expect(expectResultOk(drafts.read())).toBeNull();
    await user.click(screen.getByRole("button", { name: "Enter invite manually" }));
    await user.type(screen.getByLabelText("Enter invite code"), "AB12-CD34-EF56");
    await screen.findByText("Invite verified with the homeserver.");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: "Where should your key live?" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Keep key in Pubky Ring/u }));
    const ring = screen.getByRole("link", { name: /Continue with Pubky Ring/u });
    expect(new URL(ring.getAttribute("href")!).searchParams.get("st")).toBe("AB12-CD34-EF56");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
