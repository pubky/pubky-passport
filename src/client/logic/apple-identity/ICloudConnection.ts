import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { readBoundedText } from "@/libs/http/boundedBody";
import { LOGGER } from "@/libs/logger/logger";
import { REQUEST_TIMEOUT_MS } from "@/libs/passportPolicy";
import type { CodedFailure } from "@/libs/result";

export const CLOUDKIT_API_ORIGIN = "https://api.apple-cloudkit.com";

/** One CloudKit error as the web API reports it, per request or per record. */
export type CloudKitError = { ckErrorCode?: unknown; serverErrorCode?: unknown };

export type CloudKitRecord = {
  recordName?: unknown;
  recordType?: unknown;
  recordChangeTag?: unknown;
  fields?: unknown;
  serverErrorCode?: unknown;
};

/** Records that succeeded, and per-record errors, split the way CloudKit JS splits them. */
export type CloudKitResponse = {
  hasErrors?: boolean;
  errors?: CloudKitError[];
  records?: CloudKitRecord[];
};

/** The private-database operations Passport uses. */
export type CloudKitDatabase = {
  fetchRecords(recordNames: string[]): Promise<CloudKitResponse>;
  newRecordsBatch(): CloudKitRecordsBatch;
};

export type CloudKitRecordsBatch = {
  create(record: {
    recordType: string;
    recordName: string;
    fields: Record<string, { value: string }>;
  }): CloudKitRecordsBatch;
  delete(record: { recordName: string; recordChangeTag: string }): CloudKitRecordsBatch;
  commit(): Promise<CloudKitResponse>;
};

export type ICloudConfiguration = Readonly<{
  containerId: string;
  apiToken: string;
  environment: "production" | "development";
}>;

export type ICloudConnectionError = CodedFailure<
  | "icloud_unavailable"
  | "icloud_popup_blocked"
  | "icloud_sign_in_cancelled"
  | "icloud_sign_in_failed"
  | "icloud_network_failed"
  | "icloud_sign_in_timeout"
  | "icloud_web_access_disabled"
>;

/**
 * How a window taken over from Sign in with Apple can fail before iCloud's page ever shows. The
 * person did nothing wrong, so these codes never reach a screen: the caller offers the iCloud
 * step again without a notice.
 */
export type ICloudHandoffError = CodedFailure<"icloud_handoff_lost" | "icloud_handoff_blocked">;

type Outcome = "signed-in" | ICloudConnectionError["code"] | ICloudHandoffError["code"];
type SignInUrl = { url: string; fetchedAt: number };
const CLOUDKIT_AUTH_ORIGIN = "https://cdn.apple-cloudkit.com";

/** 390px wide, the width of the Passport column it opens from. */
const POPUP_FEATURES = "popup,width=390,height=700";
const POPUP_CLOSED_POLL_MS = 500;
/** Gives the popup's last message time to arrive after the window closes itself. */
const POPUP_CLOSED_GRACE_MS = 5_000;
/**
 * A window taken over from Sign in with Apple that is gone this soon, before CloudKit's page has
 * sent anything, was closed by the browser: iOS Safari closes it when its own sign-in sheet is
 * done. Nobody was signing in to iCloud in it, so the long grace above has nothing to wait for.
 * The time counts up to the last moment Passport saw the window open, so a page that iOS
 * suspended meanwhile does not age the attempt out.
 */
const HANDOFF_LOST_MS = 5_000;
/**
 * How long such a window must stay closed before the attempt ends. Long enough for a session
 * that Apple's page posted in the same step as its close to be delivered, and for a handle that
 * reads closed for a moment to read open again; short enough to pass as "at once".
 */
const HANDOFF_LOST_CONFIRM_MS = 300;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** CloudKit JS refreshes its sign-in URL every 14 minutes; Passport refreshes earlier. */
const SIGN_IN_URL_MAX_AGE_MS = 10 * 60_000;
const SIGN_IN_URL_REFRESH_MS = 8 * 60_000;
const PREPARE_RETRY_MS = 30_000;
const MAXIMUM_RESPONSE_BYTES = 256 * 1024;
const MAXIMUM_SESSION_CHARACTERS = 8 * 1024;
const ROTATED_SESSION_HEADERS = ["x-apple-cloudkit-web-auth-token", "x-apple-cloudkit-session"];

/**
 * Talks to the user's iCloud private database through Apple's CloudKit web API, without
 * CloudKit JS, so no Apple script runs on Passport's origin.
 *
 * Sign-in is CloudKit's web flow: `users/caller` without a session answers 421 with Apple's
 * sign-in URL; Passport opens it in a popup from the user's click; the popup posts
 * `{ ckSession }` back. Only a message from that popup window at cdn.apple-cloudkit.com is
 * read. The session lives in this object's memory only, is sent only to api.apple-cloudkit.com
 * (as `ckWebAuthToken`, like CloudKit JS), and follows Apple's rotation headers.
 *
 * Use: {@link prepare} when the "Connect iCloud" step appears, then {@link connect} directly
 * from the user's click; it opens Apple's popup synchronously. Each window gets its own sign-in
 * URL. Once Sign in with Apple starts, a second URL is kept as a spare, so the step after a lost
 * or closed window is ready without another fetch.
 */
export class ICloudConnection {
  /** Unused sign-in URLs, oldest first. */
  private signInUrls: SignInUrl[] = [];
  private urlsWanted = 1;
  /** After a failed fetch, the earliest time for a fetch nobody is waiting for. */
  private retryAt = 0;
  private session: string | undefined;
  private disposed = false;
  private generation = 0;
  private pending:
    Promise<ResultType<CloudKitDatabase, ICloudConnectionError | ICloudHandoffError>> | undefined;
  private cancelPending: (() => void) | undefined;
  private fetching: Promise<ResultType<void, ICloudConnectionError>> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt:
    | {
        popup: Window;
        finish: (outcome: Outcome) => void;
        /** Looks at the window now instead of at the next poll. */
        check: () => void;
        /** Ends the attempt for a window that is gone. */
        windowGone: () => void;
      }
    | undefined;

  constructor(
    private readonly configuration: ICloudConfiguration,
    private readonly fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private readonly appWindow: Window = globalThis.window,
  ) {
    appWindow.addEventListener("focus", this.onPageReturn);
    appWindow.document.addEventListener("visibilitychange", this.onPageReturn);
  }

  /**
   * Prepare on page load. Refresh before expiry and after returning to a suspended page.
   * Settles once one sign-in URL is ready.
   *
   * @param options.spare Also keep a second URL from now on. Ask when Sign in with Apple
   * starts: its window takes the first URL, and the spare serves the next click if the browser
   * closes that window.
   */
  prepare(options: { spare?: boolean } = {}): Promise<ResultType<void, ICloudConnectionError>> {
    if (this.disposed) return Promise.resolve(Result.err({ code: "icloud_unavailable" }));
    if (options.spare) this.urlsWanted = 2;
    if (this.session) return Promise.resolve(Result.ok());
    if (this.usableUrls().length === 0) return this.fetchNext();
    this.topUp();
    return Promise.resolve(Result.ok());
  }

  /** Whether a click can open Apple's sign-in page directly, without "Preparing iCloud…". */
  isPrepared(): boolean {
    return !this.disposed && (this.session !== undefined || this.usableUrls().length > 0);
  }

  /**
   * Keeps enough fresh sign-in URLs ready: fetches one more when fewer are fresh than wanted,
   * otherwise waits until the oldest needs replacing. Never while a window is open (if that
   * sign-in succeeds, no further URL is needed), and after a failed fetch not before the retry
   * wait is over.
   */
  private topUp(): void {
    if (this.disposed || this.session || this.attempt) return;
    const now = Date.now();
    const waiting = now < this.retryAt;
    if (!waiting && this.signInUrls.filter(isFresh).length < this.urlsWanted) {
      void this.fetchNext();
      return;
    }
    const oldest = this.signInUrls[0];
    const due = waiting ? this.retryAt : oldest && oldest.fetchedAt + SIGN_IN_URL_REFRESH_MS;
    if (due === undefined) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.topUp(), Math.max(0, due - now));
  }

  /** One fetch at a time. Each is followed by the next, or by the wait for it. */
  private fetchNext(): Promise<ResultType<void, ICloudConnectionError>> {
    this.fetching ??= this.fetchSignInUrl()
      .finally(() => {
        this.fetching = undefined;
      })
      .then((result) => {
        this.topUp();
        return result;
      });
    return this.fetching;
  }

  private async fetchSignInUrl(): Promise<ResultType<void, ICloudConnectionError>> {
    let result: ResultType<void, ICloudConnectionError>;
    try {
      const response = await this.request("public", "users/caller");
      if (this.disposed) return Result.err({ code: "icloud_unavailable" });
      const url = response.status === 421 ? signInUrlFrom(response.body) : undefined;
      if (url) {
        // A session that arrived meanwhile needs no sign-in URL.
        if (!this.session) {
          this.signInUrls = [...this.usableUrls(), { url, fetchedAt: Date.now() }].slice(
            -this.urlsWanted,
          );
        }
        result = Result.ok();
      } else {
        result = Result.err({ code: "icloud_unavailable" });
      }
    } catch (error) {
      result = Result.err({
        code: isNetworkFailure(error) ? "icloud_network_failed" : "icloud_unavailable",
      });
    }
    this.retryAt = Result.isOk(result) ? 0 : Date.now() + PREPARE_RETRY_MS;
    if (Result.isError(result)) this.logOutcome(result.error.code, "prepare");
    return result;
  }

  /** The URLs Apple still accepts, oldest first. */
  private usableUrls(): SignInUrl[] {
    return this.signInUrls.filter(
      ({ fetchedAt }) => Date.now() - fetchedAt < SIGN_IN_URL_MAX_AGE_MS,
    );
  }

  /** The oldest URL Apple still accepts. A URL serves one window only. */
  private takeSignInUrl(): SignInUrl | undefined {
    this.signInUrls = this.usableUrls();
    return this.signInUrls.shift();
  }

  /**
   * The closed-window poll is throttled or paused while Passport's page is in the background,
   * so look at Apple's window as soon as the person is back.
   */
  private onPageReturn = (): void => {
    if (this.appWindow.document.visibilityState === "hidden") return;
    if (this.attempt) this.attempt.check();
    else this.topUp();
  };

  /**
   * Opens synchronously on a click, or adopts the window used for Sign in with Apple. A page
   * suspended beyond the URL lifetime opens a blank window first, then refreshes and navigates
   * that window; expiry itself is never an error and never needs another popup permission.
   *
   * An adopted window that is gone before iCloud's page loads settles at once with an
   * {@link ICloudHandoffError}; only an adopted window does.
   */
  connect(
    existingPopup?: Window,
  ): Promise<ResultType<CloudKitDatabase, ICloudConnectionError | ICloudHandoffError>> {
    if (this.disposed) return Promise.resolve(Result.err({ code: "icloud_unavailable" }));
    if (this.pending) {
      this.focusPopup();
      return this.pending;
    }
    if (this.session) return Promise.resolve(Result.ok(this.database()));
    if (existingPopup && isClosed(existingPopup)) {
      this.logOutcome("icloud_handoff_lost");
      return Promise.resolve(Result.err({ code: "icloud_handoff_lost" }));
    }
    const signIn = this.takeSignInUrl();
    const url = signIn?.url;
    let popup: Window | null;
    try {
      popup = existingPopup ?? this.appWindow.open(url ?? "about:blank", "_blank", POPUP_FEATURES);
    } catch {
      popup = null;
    }
    if (!popup) {
      // The window never opened, so its URL is still unused.
      if (signIn) this.signInUrls.unshift(signIn);
      this.logOutcome("icloud_popup_blocked");
      return Promise.resolve(Result.err({ code: "icloud_popup_blocked" }));
    }
    const generation = this.generation;
    const cancelled = new Promise<ResultType<CloudKitDatabase, ICloudConnectionError>>(
      (resolve) => {
        this.cancelPending = () => {
          this.generation++;
          this.session = undefined;
          this.attempt?.finish("icloud_sign_in_cancelled");
          this.topUp();
          resolve(Result.err({ code: "icloud_sign_in_cancelled" }));
        };
      },
    );
    const pending = Promise.race([
      this.awaitSession(popup, generation, existingPopup !== undefined),
      cancelled,
    ])
      .then((result) => {
        this.logOutcome(Result.isOk(result) ? "signed-in" : result.error.code);
        return result;
      })
      .finally(() => {
        if (this.pending === pending) {
          this.pending = undefined;
          this.cancelPending = undefined;
        }
      });
    this.pending = pending;
    if (existingPopup || !url) void this.navigatePopup(popup, url, existingPopup !== undefined);
    return pending;
  }

  /** Whether a sign-in attempt is waiting on a window that is still open. */
  hasOpenWindow(): boolean {
    return this.attempt !== undefined && !isClosed(this.attempt.popup);
  }

  /** Focus the current window; if it has closed, return to the retry screen. */
  focusPopup(): void {
    const attempt = this.attempt;
    if (!attempt) return;
    try {
      if (attempt.popup.closed) attempt.windowGone();
      else attempt.popup.focus();
    } catch {
      // A browser may sever the WindowProxy. The user can cancel or wait for the timeout.
    }
  }

  cancel(): void {
    this.cancelPending?.();
  }

  /** Forgets credentials immediately and releases all timers and event listeners. */
  dispose(): void {
    this.disposed = true;
    this.session = undefined;
    this.signInUrls = [];
    clearTimeout(this.refreshTimer);
    this.appWindow.removeEventListener("focus", this.onPageReturn);
    this.appWindow.document.removeEventListener("visibilitychange", this.onPageReturn);
    this.cancel();
  }

  private async navigatePopup(
    popup: Window,
    url: string | undefined,
    handedOver: boolean,
  ): Promise<void> {
    if (!url) {
      const prepared = await this.prepare();
      if (this.attempt?.popup !== popup || this.disposed) return;
      if (Result.isError(prepared)) return this.attempt.finish(prepared.error.code);
      url = this.takeSignInUrl()?.url;
      if (!url) return this.attempt.finish("icloud_unavailable");
    }
    if (this.attempt?.popup !== popup) return;
    try {
      if (popup.closed) return this.attempt.windowGone();
      popup.location.href = url;
    } catch {
      // The browser would not let Passport send the window on.
      this.attempt.finish(handedOver ? "icloud_handoff_blocked" : "icloud_sign_in_cancelled");
    }
  }

  private async awaitSession(
    popup: Window,
    generation: number,
    handedOver: boolean,
  ): Promise<ResultType<CloudKitDatabase, ICloudConnectionError | ICloudHandoffError>> {
    const outcome = await new Promise<Outcome>((resolve) => {
      const startedAt = Date.now();
      let lastOpenAt = startedAt;
      let closedAt: number | undefined;
      let confirmTimer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      let heardFromPage = false;
      let reportedOtherWindow = false;
      let reportedNavigation = false;
      const finish = (result: Outcome) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(confirmTimer);
        this.appWindow.removeEventListener("message", onMessage);
        this.attempt = undefined;
        // The attempt used a URL up. Fetch the next one now, so a retry opens directly too.
        if (result !== "signed-in") this.topUp();
        resolve(result);
      };
      /** See {@link HANDOFF_LOST_MS}. Later, or after a message, the window's end is the user's. */
      const lostHandoff = () =>
        handedOver && !heardFromPage && lastOpenAt - startedAt < HANDOFF_LOST_MS;
      const onMessage = (event: MessageEvent) => {
        // Apple's shipped flow returns through this same window. Accepting unrelated Apple
        // windows would allow a concurrent sign-in to inject a different account's session.
        if (event.origin !== CLOUDKIT_AUTH_ORIGIN) return;
        if (event.source !== popup) {
          if (!reportedOtherWindow)
            LOGGER.info("identity.apple.icloud.signal", { code: "different_window" });
          reportedOtherWindow = true;
          return;
        }
        heardFromPage = true;
        const data: unknown = event.data;
        if (!isRecord(data)) return;
        if (isSession(data.ckSession)) {
          this.session = data.ckSession;
          finish("signed-in");
        } else if (typeof data.errorMessage === "string") {
          // beforeunload can also mean navigation, not cancellation. Only closed polling or
          // the timeout settles this signal, leaving time for the final session message.
          if (data.errorMessage === "window closed") {
            if (!reportedNavigation)
              LOGGER.info("identity.apple.icloud.signal", { code: "navigation_notice" });
            reportedNavigation = true;
            return;
          }
          finish(
            data.errorMessage === "accessError"
              ? "icloud_web_access_disabled"
              : "icloud_sign_in_failed",
          );
        }
      };
      const check = () => {
        if (settled) return;
        const now = Date.now();
        // An isolated proxy that cannot be read is not proof of cancellation.
        const closed = isClosed(popup);
        if (!closed) {
          closedAt = undefined;
          lastOpenAt = now;
        }
        // A lost handoff stays one even if Passport's page slept through the time limit.
        const lost = closed && lostHandoff();
        if (!lost && now - startedAt >= SIGN_IN_TIMEOUT_MS) return finish("icloud_sign_in_timeout");
        if (!closed) return;
        closedAt ??= now;
        // The listener stays on while the close is confirmed: a session still counts.
        const wait = lost ? HANDOFF_LOST_CONFIRM_MS : POPUP_CLOSED_GRACE_MS;
        if (now - closedAt >= wait) {
          return finish(lost ? "icloud_handoff_lost" : "icloud_sign_in_cancelled");
        }
        if (lost) {
          // Do not leave the confirmation to the next poll: it may be throttled.
          clearTimeout(confirmTimer);
          confirmTimer = setTimeout(check, closedAt + HANDOFF_LOST_CONFIRM_MS - now);
        }
      };
      const poll = setInterval(check, POPUP_CLOSED_POLL_MS);
      const windowGone = () => {
        if (lostHandoff()) check();
        else finish("icloud_sign_in_cancelled");
      };
      this.attempt = { popup, finish, check, windowGone };
      this.appWindow.addEventListener("message", onMessage);
    });
    try {
      // Also when the handle reads closed: a browser may report that for a window that lives.
      popup.close();
    } catch {
      /* Best effort. */
    }
    if (this.disposed) return Result.err({ code: "icloud_sign_in_cancelled" });
    if (outcome !== "signed-in") {
      return Result.err({ code: outcome });
    }
    return this.confirmSession(generation);
  }

  /** Confirm the session with CloudKit before exposing a database to the file store. */
  private async confirmSession(
    generation: number,
  ): Promise<ResultType<CloudKitDatabase, ICloudConnectionError>> {
    let code: ICloudConnectionError["code"] = "icloud_sign_in_failed";
    try {
      const response = await this.request("public", "users/caller");
      if (this.disposed || this.generation !== generation) {
        if (this.generation === generation) this.session = undefined;
        return Result.err({ code: "icloud_sign_in_cancelled" });
      }
      if (response.status === 200) {
        // Signed in: no window will need a sign-in URL any more.
        this.signInUrls = [];
        clearTimeout(this.refreshTimer);
        return Result.ok(this.database());
      }
    } catch (error) {
      code = isNetworkFailure(error) ? "icloud_network_failed" : "icloud_sign_in_failed";
    }
    if (this.generation !== generation) return Result.err({ code: "icloud_sign_in_cancelled" });
    this.session = undefined;
    this.topUp();
    return Result.err({ code });
  }

  private logOutcome(code: Outcome, stage = "sign_in"): void {
    // A fixed enum only: never log URLs, messages, subjects, tokens or Apple response bodies.
    LOGGER.info("identity.apple.icloud.outcome", { stage, code });
  }

  private database(): CloudKitDatabase {
    return {
      fetchRecords: (recordNames) =>
        this.recordsRequest("records/lookup", {
          records: recordNames.map((recordName) => ({ recordName })),
        }),
      newRecordsBatch: () => {
        const operations: unknown[] = [];
        const batch: CloudKitRecordsBatch = {
          create(record) {
            operations.push({ operationType: "create", record });
            return batch;
          },
          delete(record) {
            operations.push({ operationType: "delete", record });
            return batch;
          },
          commit: () => this.recordsRequest("records/modify", { operations }),
        };
        return batch;
      },
    };
  }

  /** @throws a {@link CloudKitError}-shaped object for request-level failures. */
  private async recordsRequest(path: string, body: unknown): Promise<CloudKitResponse> {
    if (!this.session) throw { serverErrorCode: "AUTHENTICATION_REQUIRED" };
    const response = await this.request("private", path, body);
    if (response.status < 200 || response.status >= 300) {
      throw { serverErrorCode: cloudKitErrorCode(response.body) } satisfies CloudKitError;
    }
    const records = isRecord(response.body) ? response.body.records : undefined;
    if (!Array.isArray(records)) throw { serverErrorCode: "UNEXPECTED_SERVER_RESPONSE" };
    const isError = (record: unknown) => isRecord(record) && "serverErrorCode" in record;
    const errors = records.filter(isError) as CloudKitError[];
    return {
      records: records.filter((record) => !isError(record)) as CloudKitRecord[],
      errors,
      hasErrors: errors.length > 0,
    };
  }

  private async request(
    database: "public" | "private",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const { containerId, environment, apiToken } = this.configuration;
    const requestedSession = this.session;
    let query = `?ckAPIToken=${encodeURIComponent(apiToken)}`;
    if (requestedSession) query += `&ckWebAuthToken=${encodeURIComponent(requestedSession)}`;
    const url = `${CLOUDKIT_API_ORIGIN}/database/1/${encodeURIComponent(containerId)}/${environment}/${database}/${path}${query}`;
    const response = await this.fetchImpl(url, {
      method: body === undefined ? "GET" : "POST",
      // text/plain keeps this a simple CORS request, as CloudKit JS sends it.
      headers: { "Content-Type": "text/plain" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (requestedSession && this.session === requestedSession && !this.disposed) {
      for (const header of ROTATED_SESSION_HEADERS) {
        const rotated = response.headers.get(header);
        if (isSession(rotated)) {
          this.session = rotated;
          break;
        }
      }
    }
    const text = await readBoundedText(response, MAXIMUM_RESPONSE_BYTES);
    if (Result.isError(text)) throw new Error("CloudKit response is unreadable.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.value);
    } catch {
      parsed = undefined;
    }
    return { status: response.status, body: parsed };
  }
}

/** HTTPS origins Apple's iCloud sign-in pages are served from. */
export function isAppleOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "") return false;
  return ["apple.com", "apple-cloudkit.com", "icloud.com", "icloud.com.cn"].some(
    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
  );
}

/** CloudKit's own error code, for logs and error mapping only. */
export function cloudKitErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { ckErrorCode, serverErrorCode } = error as CloudKitError;
    if (typeof ckErrorCode === "string" && /^[A-Z_]{1,64}$/u.test(ckErrorCode)) return ckErrorCode;
    if (typeof serverErrorCode === "string" && /^[A-Z_]{1,64}$/u.test(serverErrorCode)) {
      return serverErrorCode;
    }
  }
  return "UNKNOWN";
}

function signInUrlFrom(body: unknown): string | undefined {
  if (!isRecord(body) || body.serverErrorCode !== "AUTHENTICATION_REQUIRED") return undefined;
  const value = body.redirectURL;
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return isAppleOrigin(url.origin) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function isSession(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= MAXIMUM_SESSION_CHARACTERS
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFresh({ fetchedAt }: SignInUrl): boolean {
  return Date.now() - fetchedAt < SIGN_IN_URL_REFRESH_MS;
}

/** A window handle that cannot be read counts as open. */
function isClosed(popup: Window): boolean {
  try {
    return popup.closed;
  } catch {
    return false;
  }
}

/** Fetch rejection or transport timeout, not an invalid/oversized Apple response. */
function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}
