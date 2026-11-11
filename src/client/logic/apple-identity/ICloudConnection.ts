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

type Outcome = "signed-in" | ICloudConnectionError["code"];
const CLOUDKIT_AUTH_ORIGIN = "https://cdn.apple-cloudkit.com";

/** 390px wide, the width of the Passport column it opens from. */
const POPUP_FEATURES = "popup,width=390,height=700";
const POPUP_CLOSED_POLL_MS = 500;
/** Gives the popup's last message time to arrive after the window closes itself. */
const POPUP_CLOSED_GRACE_MS = 5_000;
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
 * from the user's click; it opens Apple's popup synchronously.
 */
export class ICloudConnection {
  private signInUrl: { url: string; fetchedAt: number } | undefined;
  private session: string | undefined;
  private disposed = false;
  private generation = 0;
  private pending: Promise<ResultType<CloudKitDatabase, ICloudConnectionError>> | undefined;
  private cancelPending: (() => void) | undefined;
  private preparing: Promise<ResultType<void, ICloudConnectionError>> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt: { popup: Window; finish: (outcome: Outcome) => void } | undefined;

  constructor(
    private readonly configuration: ICloudConfiguration,
    private readonly fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private readonly appWindow: Window = globalThis.window,
  ) {
    appWindow.addEventListener("focus", this.refreshOnReturn);
    appWindow.document.addEventListener("visibilitychange", this.refreshOnReturn);
  }

  /** Prepare on page load. Refresh before expiry and after returning to a suspended page. */
  prepare(): Promise<ResultType<void, ICloudConnectionError>> {
    if (this.disposed) return Promise.resolve(Result.err({ code: "icloud_unavailable" }));
    if (this.session || this.hasFreshUrl()) return Promise.resolve(Result.ok());
    if (this.preparing) return this.preparing;
    this.preparing = this.fetchSignInUrl().finally(() => {
      this.preparing = undefined;
    });
    return this.preparing;
  }

  private async fetchSignInUrl(): Promise<ResultType<void, ICloudConnectionError>> {
    let result: ResultType<void, ICloudConnectionError>;
    try {
      const response = await this.request("public", "users/caller");
      if (this.disposed) return Result.err({ code: "icloud_unavailable" });
      const url = response.status === 421 ? signInUrlFrom(response.body) : undefined;
      if (url) {
        this.signInUrl = { url, fetchedAt: Date.now() };
        result = Result.ok();
      } else {
        result = Result.err({ code: "icloud_unavailable" });
      }
    } catch (error) {
      result = Result.err({
        code: isNetworkFailure(error) ? "icloud_network_failed" : "icloud_unavailable",
      });
    }
    if (!this.disposed && !this.session) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(
        () => {
          void this.prepare();
        },
        Result.isOk(result) ? SIGN_IN_URL_REFRESH_MS : PREPARE_RETRY_MS,
      );
    }
    if (Result.isError(result)) this.logOutcome(result.error.code, "prepare");
    return result;
  }

  private hasFreshUrl(): boolean {
    return (
      this.signInUrl !== undefined && Date.now() - this.signInUrl.fetchedAt < SIGN_IN_URL_REFRESH_MS
    );
  }

  private refreshOnReturn = (): void => {
    if (this.appWindow.document.visibilityState !== "hidden" && !this.attempt) void this.prepare();
  };

  /**
   * Opens synchronously on a click, or adopts the window used for Sign in with Apple. A page
   * suspended beyond the URL lifetime opens a blank window first, then refreshes and navigates
   * that window; expiry itself is never an error and never needs another popup permission.
   */
  connect(existingPopup?: Window): Promise<ResultType<CloudKitDatabase, ICloudConnectionError>> {
    if (this.disposed) return Promise.resolve(Result.err({ code: "icloud_unavailable" }));
    if (this.pending) {
      this.focusPopup();
      return this.pending;
    }
    if (this.session) return Promise.resolve(Result.ok(this.database()));
    const signIn = this.signInUrl;
    const url =
      signIn && Date.now() - signIn.fetchedAt < SIGN_IN_URL_MAX_AGE_MS ? signIn.url : undefined;
    let popup: Window | null;
    try {
      popup = existingPopup ?? this.appWindow.open(url ?? "about:blank", "_blank", POPUP_FEATURES);
      if (existingPopup?.closed) popup = null;
    } catch {
      popup = null;
    }
    if (!popup) {
      const code = existingPopup ? "icloud_sign_in_cancelled" : "icloud_popup_blocked";
      this.logOutcome(code);
      return Promise.resolve(Result.err({ code }));
    }
    const generation = this.generation;
    const cancelled = new Promise<ResultType<CloudKitDatabase, ICloudConnectionError>>(
      (resolve) => {
        this.cancelPending = () => {
          this.generation++;
          this.session = undefined;
          this.attempt?.finish("icloud_sign_in_cancelled");
          resolve(Result.err({ code: "icloud_sign_in_cancelled" }));
        };
      },
    );
    const pending = Promise.race([this.awaitSession(popup, generation), cancelled])
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
    if (existingPopup || !url) void this.navigatePopup(popup, url);
    this.signInUrl = undefined;
    clearTimeout(this.refreshTimer);
    return pending;
  }

  /** Focus the current window; if it has closed, return to the retry screen. */
  focusPopup(): void {
    const attempt = this.attempt;
    if (!attempt) return;
    try {
      if (attempt.popup.closed) attempt.finish("icloud_sign_in_cancelled");
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
    this.signInUrl = undefined;
    clearTimeout(this.refreshTimer);
    this.appWindow.removeEventListener("focus", this.refreshOnReturn);
    this.appWindow.document.removeEventListener("visibilitychange", this.refreshOnReturn);
    this.cancel();
  }

  private async navigatePopup(popup: Window, url: string | undefined): Promise<void> {
    if (!url) {
      const prepared = await this.prepare();
      if (this.attempt?.popup !== popup || this.disposed) return;
      if (Result.isError(prepared)) return this.attempt.finish(prepared.error.code);
      url = this.signInUrl?.url;
      this.signInUrl = undefined;
      clearTimeout(this.refreshTimer);
    }
    if (this.attempt?.popup !== popup) return;
    try {
      if (!url || popup.closed) return this.attempt.finish("icloud_sign_in_cancelled");
      popup.location.href = url;
    } catch {
      this.attempt.finish("icloud_sign_in_cancelled");
    }
  }

  private async awaitSession(
    popup: Window,
    generation: number,
  ): Promise<ResultType<CloudKitDatabase, ICloudConnectionError>> {
    const outcome = await new Promise<Outcome>((resolve) => {
      const startedAt = Date.now();
      let closedAt: number | undefined;
      let settled = false;
      let reportedOtherWindow = false;
      let reportedNavigation = false;
      const finish = (result: Outcome) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        this.appWindow.removeEventListener("message", onMessage);
        this.attempt = undefined;
        resolve(result);
      };
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
      const poll = setInterval(() => {
        if (Date.now() - startedAt >= SIGN_IN_TIMEOUT_MS) return finish("icloud_sign_in_timeout");
        let closed = false;
        try {
          closed = popup.closed;
        } catch {
          /* An isolated proxy is not proof of cancellation. */
        }
        if (!closed) {
          closedAt = undefined;
          return;
        }
        closedAt ??= Date.now();
        if (Date.now() - closedAt >= POPUP_CLOSED_GRACE_MS) finish("icloud_sign_in_cancelled");
      }, POPUP_CLOSED_POLL_MS);
      this.attempt = { popup, finish };
      this.appWindow.addEventListener("message", onMessage);
    });
    try {
      if (!popup.closed) popup.close();
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
        return Result.ok(this.database());
      }
    } catch (error) {
      code = isNetworkFailure(error) ? "icloud_network_failed" : "icloud_sign_in_failed";
    }
    if (this.generation !== generation) return Result.err({ code: "icloud_sign_in_cancelled" });
    this.session = undefined;
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

/** Fetch rejection or transport timeout, not an invalid/oversized Apple response. */
function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}
