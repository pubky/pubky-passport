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
import type { AppleIdentityCredentials, SignInWithApple } from "./SignInWithApple";

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
    attachIdentity: vi.fn(async () =>
      Result.ok({ attachment: "created" as const, appleAccount: established.appleAccount }),
    ),
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

  it("runs both steps in the same window after the checked Apple response", async () => {
    const { controller, signIn, connection } = setup();
    const popup = { closed: false } as Window;
    const credentials = await signIn();
    signIn.mockImplementationOnce(async (...args) => {
      const continueInPopup = (
        args as unknown as [(popup: Window, credentials: AppleIdentityCredentials) => boolean]
      )[0];
      expect(continueInPopup(popup, expectResultOk(credentials))).toBe(true);
      return credentials;
    });
    expectResultOk(await controller.continueWithApple());
    expect(connection.connect).toHaveBeenCalledWith(popup);
    expect(controller.getState().status).toBe("established");
  });

  it("keeps a usable second step after an automatic iCloud error", async () => {
    const { controller, signIn, connection } = setup();
    const credentials = await signIn();
    connection.connect.mockResolvedValueOnce(Result.err({ code: "icloud_web_access_disabled" }));
    signIn.mockImplementationOnce(async (...args) => {
      (args as unknown as [(popup: Window, credentials: AppleIdentityCredentials) => boolean])[0](
        { closed: false } as Window,
        expectResultOk(credentials),
      );
      return credentials;
    });
    expectResultOk(await controller.continueWithApple());
    expect(controller.getState()).toEqual({
      status: "connect-icloud",
      ready: true,
      notice: "icloud_web_access_disabled",
    });
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
    expect(connection.prepare).toHaveBeenCalled();
  });

  it("focuses and cancels Apple sign-in, allowing another attempt", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    let finishSignIn!: (result: Awaited<ReturnType<SignInWithApple["signIn"]>>) => void;
    const signIn = vi.fn<SignInWithApple["signIn"]>(
      () =>
        new Promise((resolve) => {
          finishSignIn = resolve;
        }),
    );
    const focusPopup = vi.fn();
    const cancel = vi.fn(() => finishSignIn(Result.err({ code: "apple_sign_in_cancelled" })));
    const { controller, connection, lifecycle } = setup({
      signInWithApple: { signIn, focusPopup, cancel },
    });
    const first = controller.continueWithApple();
    expect(controller.getState().status).toBe("requesting-apple");
    controller.focusSignIn();
    expect(focusPopup).toHaveBeenCalledOnce();
    controller.cancelSignIn();

    expect(cancel).toHaveBeenCalledOnce();
    expectResultError(await first, { code: "apple_sign_in_cancelled" });
    expect(connection.connect).not.toHaveBeenCalled();
    expect(lifecycle.establishIdentity).not.toHaveBeenCalled();

    const retry = controller.continueWithApple();
    expect(signIn).toHaveBeenCalledTimes(2);
    controller.cancelSignIn();
    expectResultError(await retry, { code: "apple_sign_in_cancelled" });
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
    expect(connection.prepare).toHaveBeenCalled();
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
    expect(connection.prepare).toHaveBeenCalled();
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

  it("attaches after both steps and publishes only safe fields", async () => {
    const { controller, lifecycle, store, states } = setup();
    await controller.attachIdentity(PUBLIC_IDENTITY);
    expectResultOk(await controller.connectICloud());
    expect(lifecycle.attachIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ appleSubject: SUBJECT }),
      store,
      PUBLIC_IDENTITY,
    );
    expect(lifecycle.establishIdentity).not.toHaveBeenCalled();
    expect(controller.getState()).toEqual({
      status: "attached",
      identity: {
        attachment: "created",
        appleAccount: APPLE_ACCOUNT,
        publicIdentity: PUBLIC_IDENTITY,
      },
    });
    expect(states.map((state) => state.status)).toContain("attaching");
    expect(JSON.stringify(states)).not.toContain(ID_TOKEN);
  });

  it("names the signed-in Apple Account when it already holds another pubky", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { controller, lifecycle } = setup();
    lifecycle.attachIdentity.mockResolvedValueOnce(
      Result.err({ code: "provider_account_in_use" }) as never,
    );
    await controller.attachIdentity(PUBLIC_IDENTITY);
    await controller.connectICloud();
    expect(controller.getState()).toEqual({
      status: "failed",
      error: { code: "provider_account_in_use" },
      appleEmail: EMAIL,
    });
  });

  it("does not attach when the controller is disposed during the attach", async () => {
    const { controller, lifecycle } = setup();
    let settle!: (value: never) => void;
    lifecycle.attachIdentity.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }) as never,
    );
    await controller.attachIdentity(PUBLIC_IDENTITY);
    const connecting = controller.connectICloud();
    await vi.waitFor(() => expect(lifecycle.attachIdentity).toHaveBeenCalled());
    controller.dispose();
    settle(Result.ok({ attachment: "created", appleAccount: APPLE_ACCOUNT }) as never);
    expectResultError(await connecting, { code: "cancelled" });
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

  it("refuses almost expired Apple credentials before connecting iCloud", async () => {
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
    expectResultError(await controller.continueWithApple(), { code: "apple_session_expired" });
    expect(lifecycle.establishIdentity).not.toHaveBeenCalled();
  });

  it("disposes a handoff if Apple credentials expire before sign-in finishes", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let resolveHandoff!: (result: Awaited<ReturnType<ICloudConnection["connect"]>>) => void;
    const staleHandoff = new Promise<Awaited<ReturnType<ICloudConnection["connect"]>>>(
      (resolve) => {
        resolveHandoff = resolve;
      },
    );
    const staleConnection = {
      prepare: vi.fn<ICloudConnection["prepare"]>(async () => Result.ok(undefined)),
      connect: vi.fn<ICloudConnection["connect"]>(() => staleHandoff),
      dispose: vi.fn(),
    };
    const freshConnection = {
      prepare: vi.fn<ICloudConnection["prepare"]>(async () => Result.ok(undefined)),
      connect: vi.fn<ICloudConnection["connect"]>(async () => Result.ok(DATABASE)),
      dispose: vi.fn(),
    };
    const createICloudConnection = vi
      .fn()
      .mockReturnValueOnce(staleConnection)
      .mockReturnValue(freshConnection);
    const { controller, createStore, lifecycle, signIn } = setup({ createICloudConnection });
    const firstPopup = { closed: false } as Window;
    const expiringCredentials = {
      ...expectResultOk(await signIn()),
      expiresAt: now + 30_001,
    };
    signIn.mockImplementationOnce(async (...args) => {
      const continueInPopup = (
        args as unknown as [(popup: Window, credentials: AppleIdentityCredentials) => boolean]
      )[0];
      expect(continueInPopup(firstPopup, expiringCredentials)).toBe(true);
      now += 2;
      return Result.ok(expiringCredentials);
    });

    expectResultError(await controller.continueWithApple(), { code: "apple_session_expired" });
    expect(staleConnection.connect).toHaveBeenCalledWith(firstPopup);
    expect(staleConnection.dispose).toHaveBeenCalledOnce();
    expect(createStore).not.toHaveBeenCalled();
    expect(lifecycle.establishIdentity).not.toHaveBeenCalled();

    resolveHandoff(Result.ok(DATABASE));
    await Promise.resolve();
    expect(controller.getState()).toEqual({
      status: "failed",
      error: { code: "apple_session_expired" },
    });
    expect(lifecycle.establishIdentity).not.toHaveBeenCalled();

    const secondPopup = { closed: false } as Window;
    const freshCredentials = expectResultOk(await signIn());
    signIn.mockImplementationOnce(async (...args) => {
      const continueInPopup = (
        args as unknown as [(popup: Window, credentials: AppleIdentityCredentials) => boolean]
      )[0];
      expect(continueInPopup(secondPopup, freshCredentials)).toBe(true);
      return Result.ok(freshCredentials);
    });

    expectResultOk(await controller.continueWithApple());
    expect(createICloudConnection).toHaveBeenCalledTimes(2);
    expect(staleConnection.connect).toHaveBeenCalledOnce();
    expect(freshConnection.connect).toHaveBeenCalledWith(secondPopup);
    expect(lifecycle.establishIdentity).toHaveBeenCalledOnce();
    expect(controller.getState().status).toBe("established");
  });

  it("does not create another connection when reset after disposal", () => {
    const { connection, controller } = setup();
    const preparedBefore = connection.prepare.mock.calls.length;
    controller.dispose();
    controller.reset();
    expect(connection.prepare).toHaveBeenCalledTimes(preparedBefore);
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
