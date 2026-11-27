/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "@/libs/logger/logger";
import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import { ICloudConnection, isAppleOrigin } from "./ICloudConnection";

const CONFIGURATION = {
  containerId: "iCloud.app.pubky.passport",
  apiToken: "0123456789abcdef0123456789abcdef",
  environment: "production" as const,
};
const SIGN_IN_URL = "https://idmsa.apple.com/IDMSWebAuth/signin?appIdKey=x";
const APPLE_ORIGIN = "https://cdn.apple-cloudkit.com";
const SESSION = "apple-session/with+chars=";
const API = "https://api.apple-cloudkit.com/database/1/iCloud.app.pubky.passport/production";

function frameWindow(): Window {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  if (!frame.contentWindow) throw new Error("No frame window.");
  return frame.contentWindow;
}

function post(data: unknown, origin: string, source: Window | null) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

/** A window Passport opened, as far as Passport can see it. */
function openedWindow() {
  const opened = {
    closed: false,
    close: vi.fn(() => {
      opened.closed = true;
    }),
    focus: vi.fn(),
    location: { href: "" },
  };
  return opened as unknown as Window & { closed: boolean; location: { href: string } };
}

/** A fake CloudKit web API: 421 with a sign-in URL until a session is sent, then records. */
function fakeCloudKit({
  rotateTo,
  numberedUrls,
}: { rotateTo?: string; numberedUrls?: boolean } = {}) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  let signInUrls = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const session = url.searchParams.get("ckWebAuthToken");
    if (url.pathname.endsWith("/public/users/caller")) {
      if (session) return Response.json({ userRecordName: "_user" });
      // Like Apple, a new URL per request when the test tells them apart.
      const redirectURL = numberedUrls ? `${SIGN_IN_URL}&n=${++signInUrls}` : SIGN_IN_URL;
      return Response.json(
        { serverErrorCode: "AUTHENTICATION_REQUIRED", redirectURL },
        { status: 421 },
      );
    }
    if (!session) {
      return Response.json({ serverErrorCode: "AUTHENTICATION_REQUIRED" }, { status: 421 });
    }
    const headers: Record<string, string> = rotateTo
      ? { "x-apple-cloudkit-web-auth-token": rotateTo }
      : {};
    if (url.pathname.endsWith("/private/records/lookup")) {
      return Response.json(
        { records: [{ recordName: "missing", serverErrorCode: "NOT_FOUND" }] },
        { headers },
      );
    }
    return Response.json(
      { records: [{ recordName: "created", recordChangeTag: "tag-1" }] },
      { headers },
    );
  });
  return { calls, fetchImpl };
}

/** Disposed after each test, so none keeps listening for another test's focus events. */
const connections: ICloudConnection[] = [];

function setup(options: { rotateTo?: string; numberedUrls?: boolean; popup?: Window | null } = {}) {
  const popup = options.popup === undefined ? frameWindow() : options.popup;
  const open = vi.fn(() => popup);
  window.open = open as unknown as typeof window.open;
  const cloudKit = fakeCloudKit(options);
  const connection = new ICloudConnection(CONFIGURATION, cloudKit.fetchImpl, window);
  connections.push(connection);
  return { ...cloudKit, connection, open, popup };
}

describe("ICloudConnection", () => {
  afterEach(() => {
    for (const connection of connections.splice(0)) connection.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("signs in through Apple's popup and talks to CloudKit with the session only", async () => {
    const { calls, connection, open, popup } = setup();
    expectResultOk(await connection.prepare());
    expect(calls[0]?.url.href).toBe(
      `${API}/public/users/caller?ckAPIToken=${CONFIGURATION.apiToken}`,
    );

    const pending = connection.connect();
    // 390px wide, like the Passport column, so the window reads as a phone-sized sheet.
    expect(open).toHaveBeenCalledWith(SIGN_IN_URL, "_blank", "popup,width=390,height=700");
    post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
    const database = expectResultOk(await pending);

    const response = await database.fetchRecords(["missing"]);
    expect(response).toEqual({
      records: [],
      errors: [{ recordName: "missing", serverErrorCode: "NOT_FOUND" }],
      hasErrors: true,
    });
    const lookup = calls.at(-1);
    expect(`${lookup?.url.origin}${lookup?.url.pathname}`).toBe(`${API}/private/records/lookup`);
    expect(lookup?.url.search).toContain(`ckWebAuthToken=${encodeURIComponent(SESSION)}`);
    expect(lookup?.init).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "text/plain" },
    });
    expect(JSON.parse(String(lookup?.init?.body))).toEqual({
      records: [{ recordName: "missing" }],
    });
    for (const call of calls) expect(call.url.origin).toBe("https://api.apple-cloudkit.com");
    expect(document.cookie).toBe("");
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
    expect(document.querySelectorAll("script")).toHaveLength(0);
  });

  it("sends create and delete batches to records/modify", async () => {
    const { calls, connection, popup } = setup();
    await connection.prepare();
    const pending = connection.connect();
    post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
    const database = expectResultOk(await pending);

    await database
      .newRecordsBatch()
      .create({ recordType: "PassportFile", recordName: "n", fields: { envelope: { value: "e" } } })
      .delete({ recordName: "n", recordChangeTag: "t" })
      .commit();

    const modify = calls.at(-1);
    expect(modify?.url.pathname).toBe(
      "/database/1/iCloud.app.pubky.passport/production/private/records/modify",
    );
    expect(JSON.parse(String(modify?.init?.body))).toEqual({
      operations: [
        {
          operationType: "create",
          record: {
            recordType: "PassportFile",
            recordName: "n",
            fields: { envelope: { value: "e" } },
          },
        },
        { operationType: "delete", record: { recordName: "n", recordChangeTag: "t" } },
      ],
    });
  });

  it("follows Apple's session rotation", async () => {
    const { calls, connection, popup } = setup({ rotateTo: "rotated-session" });
    await connection.prepare();
    const pending = connection.connect();
    post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
    const database = expectResultOk(await pending);
    await database.fetchRecords(["a"]);
    await database.fetchRecords(["b"]);
    expect(calls.at(-1)?.url.searchParams.get("ckWebAuthToken")).toBe("rotated-session");
  });

  it("ignores sessions from other windows or non-Apple origins", async () => {
    const { calls, connection, popup } = setup();
    await connection.prepare();
    const pending = connection.connect();
    post({ ckSession: "attacker" }, "https://evil.example", popup);
    post({ ckSession: "attacker" }, APPLE_ORIGIN, frameWindow());
    post({ ckSession: "attacker" }, "http://idmsa.apple.com", popup);
    post("ckSession=attacker", APPLE_ORIGIN, popup);
    post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
    const database = expectResultOk(await pending);
    await database.fetchRecords(["a"]);
    expect(calls.some((call) => call.url.search.includes("attacker"))).toBe(false);
  });

  it("refuses a sign-in URL outside Apple", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const connection = new ICloudConnection(
      CONFIGURATION,
      async () =>
        Response.json(
          { serverErrorCode: "AUTHENTICATION_REQUIRED", redirectURL: "https://evil.example/" },
          { status: 421 },
        ),
      window,
    );
    expectResultError(await connection.prepare(), { code: "icloud_unavailable" });
    expectResultError(await connection.connect(), { code: "icloud_unavailable" });
  });

  it("reports a blocked popup", async () => {
    const { connection } = setup({ popup: null });
    await connection.prepare();
    expectResultError(await connection.connect(), { code: "icloud_popup_blocked" });
  });

  it("treats a popup closed without signing in as cancelled", async () => {
    vi.useFakeTimers();
    const closable = { closed: false, close: vi.fn() } as unknown as Window;
    const { connection } = setup({ popup: closable });
    await connection.prepare();
    const pending = connection.connect();
    (closable as { closed: boolean }).closed = true;
    await vi.advanceTimersByTimeAsync(5_500);
    expectResultError(await pending, { code: "icloud_sign_in_cancelled" });
  });

  it("maps an error from Apple's popup", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { connection, popup } = setup();
    await connection.prepare();
    const pending = connection.connect();
    post({ errorMessage: "SIGN_IN_FAILED" }, APPLE_ORIGIN, popup);
    expectResultError(await pending, { code: "icloud_sign_in_failed" });
  });

  it("is unavailable when CloudKit cannot be reached", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const connection = new ICloudConnection(
      CONFIGURATION,
      async () => {
        throw new TypeError("offline");
      },
      window,
    );
    const prepared = await connection.prepare();
    expect(Result.isError(prepared) && prepared.error.code).toBe("icloud_network_failed");
  });

  it("refreshes before expiry and when a suspended page returns", async () => {
    vi.useFakeTimers();
    const { connection, fetchImpl } = setup();
    await connection.prepare();
    await vi.advanceTimersByTimeAsync(8 * 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 11 * 60_000);
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    connection.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reserves a window synchronously on a stale click, then re-arms it", async () => {
    vi.useFakeTimers();
    const popup = { closed: false, close: vi.fn(), location: { href: "" } } as unknown as Window;
    const { connection, open, fetchImpl } = setup({ popup });
    await connection.prepare();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    const pending = connection.connect();
    expect(open).toHaveBeenCalledWith("about:blank", "_blank", expect.any(String));
    await vi.waitFor(() => expect(popup.location.href).toBe(SIGN_IN_URL));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
    expectResultOk(await pending);
    connection.dispose();
  });

  it("adopts the first Apple window without opening a second one", async () => {
    const popup = { closed: false, close: vi.fn(), location: { href: "" } } as unknown as Window;
    const { connection, open } = setup({ popup });
    await connection.prepare();
    const pending = connection.connect(popup);
    expect(open).not.toHaveBeenCalled();
    expect(popup.location.href).toBe(SIGN_IN_URL);
    post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
    expectResultOk(await pending);
    connection.dispose();
  });

  it("ignores navigation's window-closed message and a transient closed handle", async () => {
    vi.useFakeTimers();
    const popup = { closed: false, close: vi.fn() } as unknown as Window;
    const { connection } = setup({ popup });
    await connection.prepare();
    const pending = connection.connect();
    post({ errorMessage: "window closed" }, APPLE_ORIGIN, popup);
    (popup as { closed: boolean }).closed = true;
    await vi.advanceTimersByTimeAsync(4_500);
    (popup as { closed: boolean }).closed = false;
    await vi.advanceTimersByTimeAsync(1_000);
    post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
    expectResultOk(await pending);
    connection.dispose();
  });

  describe("a window handed over from Sign in with Apple", () => {
    it("ends within a moment, without the close grace, when it closes before iCloud's page spoke", async () => {
      vi.useFakeTimers();
      const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const popup = openedWindow();
      const { connection, open } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect(popup);
      expect(connection.hasOpenWindow()).toBe(true);
      // iOS Safari closes the window when its own Apple sheet is done.
      popup.closed = true;
      expect(connection.hasOpenWindow()).toBe(false);
      // The next poll sees it; 300 ms later the close is confirmed.
      await vi.advanceTimersByTimeAsync(800);
      expectResultError(await pending, { code: "icloud_handoff_lost" });
      expect(open).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith("identity.apple.icloud.outcome", {
        stage: "sign_in",
        code: "icloud_handoff_lost",
      });
      connection.dispose();
    });

    it.each(["focus", "visibilitychange"] as const)(
      "looks at the window on %s, before the next poll",
      async (event) => {
        vi.useFakeTimers();
        vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
        const popup = openedWindow();
        const { connection } = setup({ popup });
        await connection.prepare();
        const pending = connection.connect(popup);
        popup.closed = true;
        (event === "focus" ? window : document).dispatchEvent(new Event(event));
        // Counted from the page's return, not from the next poll.
        await vi.advanceTimersByTimeAsync(300);
        expectResultError(await pending, { code: "icloud_handoff_lost" });
        connection.dispose();
      },
    );

    it("is lost, not blocked or cancelled, when it is already closed", async () => {
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const popup = openedWindow();
      popup.closed = true;
      const { connection, open } = setup({ popup });
      await connection.prepare();
      expectResultError(await connection.connect(popup), { code: "icloud_handoff_lost" });
      expect(popup.location.href).toBe("");
      // Its sign-in URL was not used: the next click opens Apple's page directly.
      void connection.connect();
      expect(open).toHaveBeenCalledWith(SIGN_IN_URL, "_blank", expect.any(String));
      connection.dispose();
    });

    it("still takes a session Apple's page posted in the same step as its close", async () => {
      vi.useFakeTimers();
      const popup = openedWindow();
      const { connection } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect(popup);
      // A fast sign-in on desktop: the close is seen, on focus, before the message is delivered.
      await vi.advanceTimersByTimeAsync(1_200);
      popup.closed = true;
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(250);
      post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
      expectResultOk(await pending);
      connection.dispose();
    });

    it("does not give up a window whose handle reads closed for a moment", async () => {
      vi.useFakeTimers();
      const popup = openedWindow();
      const { connection } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect(popup);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      popup.closed = true;
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(250);
      popup.closed = false;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(settled).toBe(false);
      expect(connection.hasOpenWindow()).toBe(true);
      post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
      expectResultOk(await pending);
      connection.dispose();
    });

    it("is still lost when iOS suspended Passport's page for a while after the handoff", async () => {
      vi.useFakeTimers();
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const popup = openedWindow();
      const { connection } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect(popup);
      // No timer runs while the page is suspended; the clock moves on.
      popup.closed = true;
      vi.setSystemTime(Date.now() + 60_000);
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(300);
      expectResultError(await pending, { code: "icloud_handoff_lost" });
      connection.dispose();
    });

    it("is lost, not timed out, when the page slept for longer than the sign-in time limit", async () => {
      vi.useFakeTimers();
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const popup = openedWindow();
      const { connection } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect(popup);
      popup.closed = true;
      vi.setSystemTime(Date.now() + 6 * 60_000);
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(300);
      expectResultError(await pending, { code: "icloud_handoff_lost" });
    });

    it("closes the window it gives up, even when the handle reads closed", async () => {
      vi.useFakeTimers();
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const popup = openedWindow();
      const { connection } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect(popup);
      popup.closed = true;
      await vi.advanceTimersByTimeAsync(800);
      expectResultError(await pending, { code: "icloud_handoff_lost" });
      expect(popup.close).toHaveBeenCalledOnce();
      connection.dispose();
    });

    it("does not look at the window while Passport's page is hidden", async () => {
      vi.useFakeTimers();
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const popup = openedWindow();
      const { connection } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect(popup);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      popup.closed = true;
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(400);
      expect(settled).toBe(false);
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(300);
      expectResultError(await pending, { code: "icloud_handoff_lost" });
      connection.dispose();
    });

    it("keeps the grace once iCloud's page has spoken, and still takes its session", async () => {
      vi.useFakeTimers();
      const popup = openedWindow();
      const { connection } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect(popup);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      post({ errorMessage: "window closed" }, APPLE_ORIGIN, popup);
      popup.closed = true;
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(4_000);
      expect(settled).toBe(false);
      post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
      expectResultOk(await pending);
      connection.dispose();
    });

    it("reports a real close after iCloud's page spoke as cancelled", async () => {
      vi.useFakeTimers();
      const popup = openedWindow();
      const { connection } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect(popup);
      post({ errorMessage: "window closed" }, APPLE_ORIGIN, popup);
      popup.closed = true;
      await vi.advanceTimersByTimeAsync(5_500);
      expectResultError(await pending, { code: "icloud_sign_in_cancelled" });
      connection.dispose();
    });

    it("keeps the grace for a close after the time a sign-in can have finished", async () => {
      vi.useFakeTimers();
      const popup = openedWindow();
      const { connection } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect(popup);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(5_000);
      // Apple's page posts the session and closes itself; the close can be seen first.
      popup.closed = true;
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(settled).toBe(false);
      post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
      expectResultOk(await pending);
      connection.dispose();
    });

    it("does not count another window's or another origin's message as iCloud's page", async () => {
      vi.useFakeTimers();
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const popup = openedWindow();
      const { connection } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect(popup);
      post({ errorMessage: "window closed" }, APPLE_ORIGIN, frameWindow());
      post({ errorMessage: "window closed" }, "https://evil.example", popup);
      post({ ckSession: "attacker" }, "https://appleid.apple.com", popup);
      popup.closed = true;
      await vi.advanceTimersByTimeAsync(800);
      expectResultError(await pending, { code: "icloud_handoff_lost" });
      connection.dispose();
    });

    it("is lost when Return to Apple's window finds it closed", async () => {
      vi.useFakeTimers();
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const popup = openedWindow();
      const { connection } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect(popup);
      popup.closed = true;
      connection.focusPopup();
      await vi.advanceTimersByTimeAsync(300);
      expectResultError(await pending, { code: "icloud_handoff_lost" });
      connection.dispose();
    });

    it("reports a window the browser will not navigate as blocked, and closes it", async () => {
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const popup = openedWindow();
      Object.defineProperty(popup, "location", {
        get: () => {
          throw new DOMException("denied", "SecurityError");
        },
      });
      const { connection } = setup({ popup });
      await connection.prepare();
      expectResultError(await connection.connect(popup), { code: "icloud_handoff_blocked" });
      expect(popup.close).toHaveBeenCalledOnce();
      connection.dispose();
    });
  });

  describe("a window opened by the click", () => {
    it("keeps the close grace even before iCloud's page spoke, on poll and on return", async () => {
      vi.useFakeTimers();
      const popup = openedWindow();
      const { connection } = setup({ popup });
      await connection.prepare();
      const pending = connection.connect();
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      popup.closed = true;
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(4_000);
      expect(settled).toBe(false);
      // The session Apple's page posted just before it closed itself still counts.
      post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
      expectResultOk(await pending);
      connection.dispose();
    });

    it("reports a failed navigation as cancelled, never as a handoff", async () => {
      vi.useFakeTimers();
      const popup = openedWindow();
      Object.defineProperty(popup, "location", {
        get: () => {
          throw new DOMException("denied", "SecurityError");
        },
      });
      const { connection } = setup({ popup });
      await connection.prepare();
      vi.setSystemTime(Date.now() + 11 * 60_000);
      expectResultError(await connection.connect(), { code: "icloud_sign_in_cancelled" });
      connection.dispose();
    });
  });

  describe("spare sign-in URL", () => {
    it("keeps one URL until Sign in with Apple starts, then two", async () => {
      const { connection, fetchImpl } = setup({ numberedUrls: true });
      expect(connection.isPrepared()).toBe(false);
      expectResultOk(await connection.prepare());
      expect(connection.isPrepared()).toBe(true);
      await Promise.resolve();
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      expectResultOk(await connection.prepare({ spare: true }));
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      expectResultOk(await connection.prepare({ spare: true }));
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      connection.dispose();
    });

    it("is ready at once after a lost handoff: the next click opens a URL no window used", async () => {
      vi.useFakeTimers();
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const handedOver = openedWindow();
      const next = openedWindow();
      const { connection, fetchImpl, open } = setup({ numberedUrls: true, popup: next });
      await connection.prepare({ spare: true });
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

      const lost = connection.connect(handedOver);
      expect(handedOver.location.href).toBe(`${SIGN_IN_URL}&n=1`);
      handedOver.closed = true;
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(300);
      expectResultError(await lost, { code: "icloud_handoff_lost" });

      // Synchronously after the attempt ended: nothing to prepare, no blank window.
      expect(connection.isPrepared()).toBe(true);
      const pending = connection.connect();
      expect(open).toHaveBeenCalledExactlyOnceWith(
        `${SIGN_IN_URL}&n=2`,
        "_blank",
        expect.any(String),
      );
      post({ ckSession: SESSION }, APPLE_ORIGIN, next);
      expectResultOk(await pending);
      connection.dispose();
    });

    it("fetches the next URL when an attempt ends without a session, not while it runs", async () => {
      vi.useFakeTimers();
      const first = openedWindow();
      const { connection, fetchImpl, open } = setup({ numberedUrls: true, popup: first });
      await connection.prepare({ spare: true });
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

      const cancelled = connection.connect();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      first.closed = true;
      await vi.advanceTimersByTimeAsync(5_500);
      expectResultError(await cancelled, { code: "icloud_sign_in_cancelled" });
      expect(connection.isPrepared()).toBe(true);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));

      const second = openedWindow();
      open.mockReturnValue(second);
      void connection.connect();
      expect(open).toHaveBeenLastCalledWith(`${SIGN_IN_URL}&n=2`, "_blank", expect.any(String));
      connection.dispose();
    });

    it("fetches nothing more once a session arrived", async () => {
      const { connection, fetchImpl, popup } = setup({ numberedUrls: true });
      await connection.prepare({ spare: true });
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      const pending = connection.connect();
      post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
      expectResultOk(await pending);
      // Two sign-in URLs and the session check; no third URL.
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expectResultOk(await connection.prepare({ spare: true }));
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      connection.dispose();
    });

    it("drops unused URLs and stops refreshing once signed in", async () => {
      vi.useFakeTimers();
      const { connection, fetchImpl, open, popup } = setup({ numberedUrls: true });
      await connection.prepare({ spare: true });
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      // Both URLs are stored and the refresh of the older one is scheduled.
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);

      const pending = connection.connect();
      expect(open).toHaveBeenCalledWith(`${SIGN_IN_URL}&n=1`, "_blank", expect.any(String));
      post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
      expectResultOk(await pending);

      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(20 * 60_000);
      window.dispatchEvent(new Event("focus"));
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it("schedules no refresh for a URL that arrives after the session", async () => {
      vi.useFakeTimers();
      let answerSpare!: (response: Response) => void;
      const { connection, fetchImpl, popup } = setup({ numberedUrls: true });
      await connection.prepare();
      fetchImpl.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            answerSpare = resolve;
          }),
      );
      await connection.prepare({ spare: true });
      const pending = connection.connect();
      post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
      expectResultOk(await pending);
      answerSpare(
        Response.json(
          { serverErrorCode: "AUTHENTICATION_REQUIRED", redirectURL: `${SIGN_IN_URL}&late` },
          { status: 421 },
        ),
      );
      await vi.advanceTimersByTimeAsync(0);
      // Signed in: the late URL is not kept fresh.
      expect(vi.getTimerCount()).toBe(0);
    });

    it("replaces each URL when that URL is 8 minutes old, not when the newest is", async () => {
      vi.useFakeTimers();
      const { connection, fetchImpl, open } = setup({ numberedUrls: true });
      await connection.prepare();
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      await connection.prepare({ spare: true });
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      // The first URL turns 8 minutes old two minutes later; the spare is 2 minutes old then.
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
      void connection.connect();
      expect(open).toHaveBeenLastCalledWith(`${SIGN_IN_URL}&n=2`, "_blank", expect.any(String));
      connection.dispose();
    });

    it("does not refetch a failed spare on every return to the page, only after the retry wait", async () => {
      vi.useFakeTimers();
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const { connection, fetchImpl } = setup({ numberedUrls: true });
      await connection.prepare();
      fetchImpl.mockRejectedValueOnce(new TypeError("offline"));
      await connection.prepare({ spare: true });
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      // The failed fetch has fully settled before the person comes back.
      await vi.advanceTimersByTimeAsync(1_000);
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new Event("focus"));
        await connection.prepare({ spare: true });
        await vi.advanceTimersByTimeAsync(1_000);
      }
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(connection.isPrepared()).toBe(true);
      await vi.advanceTimersByTimeAsync(24_000);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it("keeps the retry wait when an attempt ends inside it, then fetches", async () => {
      vi.useFakeTimers();
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const { connection, fetchImpl } = setup({ numberedUrls: true });
      await connection.prepare();
      fetchImpl.mockRejectedValueOnce(new TypeError("offline"));
      await connection.prepare({ spare: true });
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(1_000);

      const pending = connection.connect();
      await vi.advanceTimersByTimeAsync(1_000);
      connection.cancel();
      expectResultError(await pending, { code: "icloud_sign_in_cancelled" });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));
      expect(connection.isPrepared()).toBe(true);
    });

    it("still opens a URL between 8 and 10 minutes old directly when its refresh failed", async () => {
      vi.useFakeTimers();
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const { connection, fetchImpl, open } = setup({ numberedUrls: true });
      await connection.prepare();
      fetchImpl.mockRejectedValueOnce(new TypeError("offline"));
      await vi.advanceTimersByTimeAsync(8 * 60_000 + 10_000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(connection.isPrepared()).toBe(true);
      void connection.connect();
      expect(open).toHaveBeenCalledWith(`${SIGN_IN_URL}&n=1`, "_blank", expect.any(String));
    });

    it("keeps the URL of a window the browser blocked", async () => {
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const { connection, fetchImpl, open } = setup({ numberedUrls: true, popup: null });
      await connection.prepare();
      expectResultError(await connection.connect(), { code: "icloud_popup_blocked" });
      expect(connection.isPrepared()).toBe(true);
      open.mockReturnValue(openedWindow());
      void connection.connect();
      expect(open).toHaveBeenLastCalledWith(`${SIGN_IN_URL}&n=1`, "_blank", expect.any(String));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      connection.dispose();
    });

    it("forgets every URL on dispose", async () => {
      const { connection, fetchImpl } = setup({ numberedUrls: true });
      await connection.prepare({ spare: true });
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      connection.dispose();
      expect(connection.isPrepared()).toBe(false);
      expectResultError(await connection.prepare(), { code: "icloud_unavailable" });
    });
  });

  it.each([
    ["accessError", "icloud_web_access_disabled"],
    // Apple's actual script collapses a refused TOS to unknownError. Do not invent certainty.
    ["unknownError", "icloud_sign_in_failed"],
  ] as const)("maps Apple's %s without logging its payload", async (message, code) => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const { connection, popup } = setup();
    await connection.prepare();
    const pending = connection.connect();
    post({ errorMessage: message, sensitiveExtra: "never-log-this" }, APPLE_ORIGIN, popup);
    expectResultError(await pending, { code });
    expect(info).toHaveBeenCalledWith("identity.apple.icloud.outcome", { stage: "sign_in", code });
    expect(JSON.stringify(info.mock.calls)).not.toContain("never-log-this");
    connection.dispose();
  });

  it("reports a timeout distinctly and releases a pending attempt on dispose", async () => {
    vi.useFakeTimers();
    const { connection } = setup();
    await connection.prepare();
    const pending = connection.connect();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expectResultError(await pending, { code: "icloud_sign_in_timeout" });
    await connection.prepare();
    const cancelled = connection.connect();
    connection.dispose();
    expectResultError(await cancelled, { code: "icloud_sign_in_cancelled" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not revive a disposed connection after a prepare response arrives", async () => {
    let reply!: (response: Response) => void;
    const connection = new ICloudConnection(
      CONFIGURATION,
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
      window,
    );
    const pending = connection.prepare();
    connection.dispose();
    reply(Response.json({ redirectURL: SIGN_IN_URL }, { status: 421 }));
    expectResultError(await pending, { code: "icloud_unavailable" });
    expectResultError(await connection.connect(), { code: "icloud_unavailable" });
  });

  it("cancels during session confirmation and never exposes that database", async () => {
    const { connection, fetchImpl, popup } = setup();
    await connection.prepare();
    let confirm!: (response: Response) => void;
    fetchImpl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    const pending = connection.connect();
    post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
    await vi.waitFor(() => expect(confirm).toBeTypeOf("function"));
    const duplicate = connection.connect();
    connection.cancel();
    expectResultError(await pending, { code: "icloud_sign_in_cancelled" });
    expectResultError(await duplicate, { code: "icloud_sign_in_cancelled" });
    confirm(Response.json({ userRecordName: "not-exposed" }));
    await Promise.resolve();
    connection.dispose();
  });

  it("forgets the session on dispose", async () => {
    const { connection, popup } = setup();
    await connection.prepare();
    const pending = connection.connect();
    post({ ckSession: SESSION }, APPLE_ORIGIN, popup);
    const database = expectResultOk(await pending);
    connection.dispose();
    await expect(database.fetchRecords(["a"])).rejects.toEqual({
      serverErrorCode: "AUTHENTICATION_REQUIRED",
    });
    expectResultError(await connection.connect(), { code: "icloud_unavailable" });
  });
});

describe("isAppleOrigin", () => {
  it.each([
    ["https://idmsa.apple.com", true],
    ["https://api.apple-cloudkit.com", true],
    ["https://www.icloud.com", true],
    ["https://apple.com", true],
    ["http://idmsa.apple.com", false],
    ["https://idmsa.apple.com:8443", false],
    ["https://apple.com.evil.example", false],
    ["https://evilapple.com", false],
    ["null", false],
  ])("%s -> %s", (origin, expected) => {
    expect(isAppleOrigin(origin)).toBe(expected);
  });
});
