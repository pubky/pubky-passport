import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "@/libs/logger/logger";
import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import {
  AppleIdentityController,
  type AppleIdentityControllerDependencies,
  type AppleIdentityViewState,
} from "./AppleIdentityController";
import type { CloudKitDatabase, ICloudConnection } from "./ICloudConnection";
import type { AppleIdentityCredentials } from "./SignInWithApple";

const ID_TOKEN = "SECRET-APPLE-ID-TOKEN";
const SUBJECT = "001234.abcdef.1234";
const EMAIL = "abc123@privaterelay.appleid.com";
const NAME = "Jane Appleseed";
const APPLE_ACCOUNT = { appleSubject: SUBJECT, email: EMAIL, name: NAME };
const PUBLIC_IDENTITY = { publicKeyZ32: "o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy" };
const DATABASE = { marker: "SECRET-CLOUDKIT-DATABASE" } as unknown as CloudKitDatabase;
const CONFIGURATION = {
  servicesId: "app.pubky.passport.signin",
  homegateBaseUrl: "https://homegate.example/",
  icloud: { containerId: "iCloud.app", apiToken: "token", environment: "production" as const },
};

function setup(overrides: Partial<AppleIdentityControllerDependencies> = {}) {
  const signIn = vi.fn(async () =>
    Result.ok<AppleIdentityCredentials>({
      appleIdToken: ID_TOKEN,
      appleSubject: SUBJECT,
      email: EMAIL,
      name: NAME,
      expiresAt: Date.now() + 600_000,
    }),
  );
  const established = {
    establishmentMode: "created" as const,
    appleAccount: APPLE_ACCOUNT,
    publicIdentity: PUBLIC_IDENTITY,
  };
  const connection = {
    prepare: vi.fn<ICloudConnection["prepare"]>(async () => Result.ok(undefined)),
    connect: vi.fn<ICloudConnection["connect"]>(async () => Result.ok(DATABASE)),
    dispose: vi.fn(),
  };
  const lifecycle = {
    establishIdentity: vi.fn(async () => Result.ok(established)),
    replaceInvalidPassportFile: vi.fn(async () => Result.ok(established)),
    replaceUndecryptablePassportFile: vi.fn(async () => Result.ok(established)),
    detachIdentity: vi.fn(async () => Result.ok(undefined)),
    abortRequests: vi.fn(),
    dispose: vi.fn(),
  };
  const store = { marker: "store" };
  const createStore = vi.fn(() => store as never);
  const controller = new AppleIdentityController(CONFIGURATION, {
    signInWithApple: { signIn },
    createICloudConnection: () => connection,
    createLifecycle: () => lifecycle,
    createStore,
    ...overrides,
  });
  const states: AppleIdentityViewState[] = [];
  controller.subscribe((state) => states.push(state));
  return { connection, controller, createStore, lifecycle, signIn, states, store };
}

describe("AppleIdentityController", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { origin: "https://passport.example" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("runs the two clicks: Apple sign-in, then Connect iCloud, then establishes", async () => {
    const { connection, controller, createStore, lifecycle, signIn, states, store } = setup();

    const first = controller.continueWithApple();
    expect(signIn).toHaveBeenCalledOnce();
    expectResultOk(await first);
    expect(controller.getState()).toEqual({ status: "connect-icloud", ready: true });
    expect(connection.connect).not.toHaveBeenCalled();

    const second = controller.connectICloud();
    expect(connection.connect).toHaveBeenCalledOnce();
    expectResultOk(await second);

    expect(createStore).toHaveBeenCalledWith(DATABASE, SUBJECT, "https://passport.example");
    expect(lifecycle.establishIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ appleIdToken: ID_TOKEN, appleSubject: SUBJECT }),
      store,
      expect.any(Function),
    );
    expect(controller.getState()).toEqual({
      status: "established",
      identity: {
        establishmentMode: "created",
        appleAccount: APPLE_ACCOUNT,
        publicIdentity: PUBLIC_IDENTITY,
      },
    });
    expect(states.map((state) => state.status)).toEqual([
      "requesting-apple",
      "connect-icloud",
      "connect-icloud",
      "connecting-icloud",
      "establishing",
      "established",
    ]);
  });

  it("never puts the Apple ID token or the CloudKit database into UI state", async () => {
    const { controller, states } = setup();
    await controller.continueWithApple();
    await controller.connectICloud();
    expect(JSON.stringify(states)).not.toContain(ID_TOKEN);
    expect(JSON.stringify(states)).not.toContain("SECRET-CLOUDKIT-DATABASE");
  });

  it("does not connect iCloud before Apple sign-in succeeded", async () => {
    const { connection, controller } = setup();
    expectResultError(await controller.connectICloud(), { code: "operation_failed" });
    expect(connection.connect).not.toHaveBeenCalled();
  });

  it("fails when Apple sign-in is cancelled", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { connection, controller } = setup({
      signInWithApple: {
        signIn: vi.fn(async () => Result.err({ code: "apple_sign_in_cancelled" as const })),
      },
    });
    expectResultError(await controller.continueWithApple(), { code: "apple_sign_in_cancelled" });
    expect(controller.getState()).toEqual({
      status: "failed",
      error: { code: "apple_sign_in_cancelled" },
    });
    expect(connection.prepare).not.toHaveBeenCalled();
  });

  it("re-arms Connect iCloud after the iCloud popup was closed", async () => {
    const { connection, controller, lifecycle } = setup();
    connection.connect.mockResolvedValueOnce(Result.err({ code: "icloud_sign_in_cancelled" }));
    await controller.continueWithApple();

    expectResultOk(await controller.connectICloud());

    expect(controller.getState()).toEqual({
      status: "connect-icloud",
      ready: true,
      notice: "icloud_sign_in_cancelled",
    });
    expect(connection.prepare).toHaveBeenCalledTimes(2);
    expect(lifecycle.establishIdentity).not.toHaveBeenCalled();
    expectResultOk(await controller.connectICloud());
    expect(controller.getState().status).toBe("established");
  });

  it("refuses to detach with a different Apple Account", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { connection, controller, lifecycle } = setup();
    expectResultError(await controller.detachIdentity(PUBLIC_IDENTITY, "other-subject"), {
      code: "apple_account_mismatch",
    });
    expect(connection.prepare).not.toHaveBeenCalled();
    expect(lifecycle.detachIdentity).not.toHaveBeenCalled();
    expect(controller.getState()).toEqual({
      status: "failed",
      error: { code: "apple_account_mismatch" },
      appleEmail: EMAIL,
    });
  });

  it("names the signed-in Apple Account when iCloud holds another account's file", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { controller, lifecycle } = setup();
    lifecycle.establishIdentity.mockResolvedValueOnce(
      Result.err({ code: "icloud_account_mismatch" }) as never,
    );
    await controller.continueWithApple();
    await controller.connectICloud();
    expect(controller.getState()).toEqual({
      status: "failed",
      error: { code: "icloud_account_mismatch" },
      appleEmail: EMAIL,
    });
  });

  it("drops the signed-in email when the flow is reset", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { controller } = setup();
    await controller.detachIdentity(PUBLIC_IDENTITY, "other-subject");
    controller.reset();
    expect(controller.getState()).toEqual({ status: "idle" });
  });

  it("keeps the name Apple sent once for a retry on the same page", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { controller, lifecycle, signIn } = setup();
    lifecycle.establishIdentity.mockResolvedValueOnce(
      Result.err({ code: "icloud_quota_exceeded" }) as never,
    );
    await controller.continueWithApple();
    await controller.connectICloud();
    signIn.mockResolvedValueOnce(
      Result.ok({
        appleIdToken: ID_TOKEN,
        appleSubject: SUBJECT,
        email: EMAIL,
        name: null,
        expiresAt: Date.now() + 600_000,
      }),
    );

    await controller.continueWithApple();
    await controller.connectICloud();

    expect(lifecycle.establishIdentity).toHaveBeenLastCalledWith(
      expect.objectContaining({ appleSubject: SUBJECT, name: NAME }),
      expect.anything(),
      expect.any(Function),
    );
  });

  it("detaches after both steps", async () => {
    const { controller, lifecycle, store } = setup();
    await controller.detachIdentity(PUBLIC_IDENTITY, SUBJECT);
    expectResultOk(await controller.connectICloud());
    expect(lifecycle.detachIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ appleSubject: SUBJECT }),
      store,
      PUBLIC_IDENTITY,
      SUBJECT,
    );
    expect(controller.getState()).toEqual({ status: "detached" });
  });

  it("reuses a live session to replace a damaged file without new popups", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { connection, controller, lifecycle, signIn } = setup();
    lifecycle.establishIdentity.mockResolvedValueOnce(
      Result.err({ code: "invalid_passport_file" }) as never,
    );
    await controller.continueWithApple();
    await controller.connectICloud();
    expect(controller.getState()).toEqual({
      status: "failed",
      error: { code: "invalid_passport_file" },
    });

    expectResultOk(await controller.replaceInvalidPassportFile());

    expect(signIn).toHaveBeenCalledOnce();
    expect(connection.connect).toHaveBeenCalledOnce();
    expect(lifecycle.replaceInvalidPassportFile).toHaveBeenCalledOnce();
  });

  it("asks Apple again when the ID token is about to expire", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { controller, lifecycle } = setup({
      signInWithApple: {
        signIn: vi.fn(async () =>
          Result.ok({
            appleIdToken: ID_TOKEN,
            appleSubject: SUBJECT,
            email: null,
            name: null,
            expiresAt: Date.now() + 1,
          }),
        ),
      },
    });
    await controller.continueWithApple();
    expectResultError(await controller.connectICloud(), { code: "apple_session_expired" });
    expect(lifecycle.establishIdentity).not.toHaveBeenCalled();
  });

  it("drops the CloudKit session and releases Pubky resources on dispose", async () => {
    const { connection, controller, lifecycle } = setup();
    await controller.continueWithApple();
    await controller.connectICloud();

    controller.dispose();

    expect(connection.dispose).toHaveBeenCalled();
    expect(lifecycle.abortRequests).toHaveBeenCalled();
    expect(lifecycle.dispose).toHaveBeenCalledOnce();
  });

  it("strips diagnostic causes from view errors", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { controller, lifecycle } = setup();
    lifecycle.establishIdentity.mockResolvedValueOnce(
      Result.err({
        code: "icloud_read_failed",
        detailCode: "network_failed",
        cause: new Error("SECRET-CAUSE"),
      }) as never,
    );
    await controller.continueWithApple();
    await controller.connectICloud();
    expect(controller.getState()).toEqual({
      status: "failed",
      error: { code: "icloud_read_failed", detailCode: "network_failed" },
    });
  });
});
