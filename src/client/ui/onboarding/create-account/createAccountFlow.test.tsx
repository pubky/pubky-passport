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
import type {
  PassportCollaborators,
  RingProfileControllerPort,
} from "@/client/ui/passportCollaborators";
import { CreateAccountFlow } from "./createAccountFlow";

const HOMESERVER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const INVITE = { homeserverPubky: HOMESERVER, signupToken: "SMS1-NV1T-E000" };
const INVOICE: LightningInvoice = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  amountSat: 100,
  bolt11Invoice: "lnbc100n1example",
  expiresAt: Date.now() + 600_000,
};

const RING_IDENTITY: LocalIdentityMetadata = {
  publicIdentity: { publicKeyZ32: "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy" },
  keySource: "ring",
  profileSetupRequired: true,
};

type Answer<T> = Result<T, HomegateVerificationFailure>;

/** A Ring profile connection that Ring approves straight away, pending the person's confirmation. */
function approvingRingProfile() {
  return {
    start: vi.fn(async () => Result.ok()),
    poll: vi.fn(async () =>
      Result.ok({ status: "approved", publicKeyZ32: RING_IDENTITY.publicIdentity.publicKeyZ32 }),
    ),
    confirm: vi.fn(() => Result.ok(RING_IDENTITY)),
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
        Result.ok(null),
        check,
        new LocalAccountDraftRepository(() => storage),
      ),
  };
  const onBack = vi.fn();
  const onLocalComplete = vi.fn();
  const view = render(
    withPassportTestProviders(
      <CreateAccountFlow
        inviteHomeserver={HOMESERVER}
        onBack={onBack}
        onLocalComplete={onLocalComplete}
        ringProfileController={options.ringProfile ?? ({} as RingProfileControllerPort)}
      />,
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
});

describe("CreateAccountFlow", () => {
  it("keeps a verified SMS invite through Cancel and offers it again without verifying", async () => {
    const user = userEvent.setup();
    const first = mountFlow();
    await user.click(screen.getByRole("button", { name: "Continue with SMS" }));
    await user.type(screen.getByLabelText("Phone number", { exact: true }), "+41791234567");
    await user.click(screen.getByRole("button", { name: "Send Code" }));
    await user.type(screen.getByLabelText("Verification code", { exact: true }), "123456");
    await user.click(screen.getByRole("button", { name: "Verify Code" }));
    expect(await screen.findByRole("heading", { name: "Choose your signer." })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(first.onBack).toHaveBeenCalledOnce();
    first.unmount();

    const second = mountFlow({ storage: first.storage });
    expect(screen.getByRole("heading", { name: "Choose your signer." })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Use Pubky Ring/u }));
    const ring = screen.getByRole("link", { name: /Continue with Pubky Ring/u });
    expect(new URL(ring.getAttribute("href")!).searchParams.get("st")).toBe(INVITE.signupToken);
    expect(first.verification.sendSmsCode).toHaveBeenCalledOnce();
    expect(first.verification.verifySmsCode).toHaveBeenCalledOnce();
    expect(second.verification.verifySmsCode).not.toHaveBeenCalled();
  });

  it("discards a saved invite only after the person confirms it", async () => {
    const user = userEvent.setup();
    const { storage } = mountFlow({ storage: storedInvite() });

    await user.click(screen.getByRole("button", { name: "Discard invite" }));
    const dialog = screen.getByRole("dialog", { name: "Discard this invite?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(storage.length).toBe(1);
    expect(screen.getByRole("heading", { name: "Choose your signer." })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Discard invite" }));
    const confirmation = screen.getByRole("dialog", { name: "Discard this invite?" });
    await user.type(within(confirmation).getByLabelText(/Type DELETE/u), "DELETE");
    await user.click(within(confirmation).getByRole("button", { name: "Discard invite" }));

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

      await user.click(screen.getByRole("button", { name: /Keep in Passport/u }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(checkSignupToken).toHaveBeenCalledWith(INVITE, expect.any(AbortSignal));
      expect(screen.getByRole("heading", { name: "Choose your signer." })).toBeVisible();
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

    await user.click(screen.getByRole("button", { name: /Use Pubky Ring/u }));

    expect(await screen.findByRole("heading", { name: /Connect your/u })).toBeVisible();
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
    expect(await screen.findByLabelText("100 sats")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Use an invite code" }));
    await user.click(screen.getByLabelText("Enter invite code"));
    await user.paste("AB12-CD34-EF56");
    await screen.findByText("Invite verified with the homeserver.");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Use Pubky Ring/u }));
    await user.click(screen.getByRole("button", { name: "Continue to profile" }));
    await user.click(await screen.findByRole("button", { name: "Yes, it is my new pubky" }));

    expect(onLocalComplete).toHaveBeenCalledWith(RING_IDENTITY);
    expect(new HomegateSignupRepository(() => storage).read()).toEqual(
      Result.ok({ invoice: INVOICE }),
    );
  });

  it("stops polling the invoice when the person switches to an invite code", async () => {
    const user = userEvent.setup();
    const scheduler = manualScheduler();
    const { verification } = mountFlow({ schedule: scheduler.schedule });
    await user.click(screen.getByRole("button", { name: "Continue with Lightning" }));
    expect(await screen.findByLabelText("100 sats")).toBeVisible();

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
    expect(screen.getByRole("heading", { name: "Choose your signer." })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Use Pubky Ring/u }));
    const ring = screen.getByRole("link", { name: /Continue with Pubky Ring/u });
    expect(new URL(ring.getAttribute("href")!).searchParams.get("st")).toBe("AB12-CD34-EF56");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
