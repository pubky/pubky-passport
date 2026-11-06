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
const APPLE_ORIGIN = "https://idmsa.apple.com";
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

/** A fake CloudKit web API: 421 with a sign-in URL until a session is sent, then records. */
function fakeCloudKit({ rotateTo }: { rotateTo?: string } = {}) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const session = url.searchParams.get("ckWebAuthToken");
    if (url.pathname.endsWith("/public/users/caller")) {
      return session
        ? Response.json({ userRecordName: "_user" })
        : Response.json(
            { serverErrorCode: "AUTHENTICATION_REQUIRED", redirectURL: SIGN_IN_URL },
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

function setup(options: { rotateTo?: string; popup?: Window | null } = {}) {
  const popup = options.popup === undefined ? frameWindow() : options.popup;
  const open = vi.fn(() => popup);
  window.open = open as unknown as typeof window.open;
  const cloudKit = fakeCloudKit(options);
  const connection = new ICloudConnection(CONFIGURATION, cloudKit.fetchImpl, window);
  return { ...cloudKit, connection, open, popup };
}

describe("ICloudConnection", () => {
  afterEach(() => {
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
    expect(open).toHaveBeenCalledWith(SIGN_IN_URL, "_blank", expect.any(String));
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
    await vi.advanceTimersByTimeAsync(2_500);
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
    expect(Result.isError(prepared) && prepared.error.code).toBe("icloud_unavailable");
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
