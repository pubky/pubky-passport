import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { readBoundedText } from "@/libs/http/boundedBody";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
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
>;

type Outcome = "signed-in" | "failed" | "cancelled" | "timeout";

const POPUP_FEATURES = "popup,width=640,height=600";
const POPUP_CLOSED_POLL_MS = 500;
/** Gives the popup's last message time to arrive after the window closes itself. */
const POPUP_CLOSED_GRACE_MS = 1_500;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** CloudKit JS refreshes its sign-in URL every 14 minutes; Passport refreshes earlier. */
const SIGN_IN_URL_MAX_AGE_MS = 10 * 60_000;
const MAXIMUM_RESPONSE_BYTES = 256 * 1024;
const MAXIMUM_SESSION_CHARACTERS = 8 * 1024;
const ROTATED_SESSION_HEADERS = ["x-apple-cloudkit-web-auth-token", "x-apple-cloudkit-session"];

/**
 * Talks to the user's iCloud private database through Apple's CloudKit web API, without
 * CloudKit JS, so no Apple script runs on Passport's origin.
 *
 * Sign-in is CloudKit's web flow: `users/caller` without a session answers 421 with Apple's
 * sign-in URL; Passport opens it in a popup from the user's click; the popup posts
 * `{ ckSession }` back. Only a message from that popup window, on an Apple HTTPS origin, is
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

  constructor(
    private readonly configuration: ICloudConfiguration,
    private readonly fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private readonly appWindow: Window = globalThis.window,
  ) {}

  /** Fetches Apple's sign-in URL so {@link connect} can open it at once. Call again to re-arm. */
  async prepare(): Promise<ResultType<void, ICloudConnectionError>> {
    if (this.disposed) return Result.err({ code: "icloud_unavailable" });
    if (this.session) return Result.ok();
    try {
      const response = await this.request("public", "users/caller");
      const url = response.status === 421 ? signInUrlFrom(response.body) : undefined;
      if (!url) {
        LOGGER.warn("identity.apple.icloud.failed", {
          stage: "prepare",
          httpStatus: response.status,
          code: cloudKitErrorCode(response.body),
        });
        return Result.err({ code: "icloud_unavailable" });
      }
      this.signInUrl = { url, fetchedAt: Date.now() };
      return Result.ok();
    } catch (e) {
      LOGGER.warn("identity.apple.icloud.failed", { stage: "prepare", ...safeErrorLogFields(e) });
      return Result.err({ code: "icloud_unavailable", cause: e });
    }
  }

  /**
   * Opens Apple's iCloud sign-in popup synchronously and settles with the private database once
   * the user signed in. The promise does not intentionally reject.
   */
  connect(): Promise<ResultType<CloudKitDatabase, ICloudConnectionError>> {
    if (this.disposed) return Promise.resolve(Result.err({ code: "icloud_unavailable" }));
    if (this.session) return Promise.resolve(Result.ok(this.database()));
    const signIn = this.signInUrl;
    if (!signIn || Date.now() - signIn.fetchedAt > SIGN_IN_URL_MAX_AGE_MS) {
      return Promise.resolve(Result.err({ code: "icloud_unavailable" }));
    }
    let popup: Window | null;
    try {
      popup = this.appWindow.open(signIn.url, "_blank", POPUP_FEATURES);
    } catch {
      popup = null;
    }
    if (!popup) return Promise.resolve(Result.err({ code: "icloud_popup_blocked" }));
    this.signInUrl = undefined;
    return this.awaitSession(popup);
  }

  /** Forgets the CloudKit session and the sign-in URL. */
  dispose(): void {
    this.disposed = true;
    this.session = undefined;
    this.signInUrl = undefined;
  }

  private async awaitSession(
    popup: Window,
  ): Promise<ResultType<CloudKitDatabase, ICloudConnectionError>> {
    const outcome = await new Promise<Outcome>((resolve) => {
      const startedAt = Date.now();
      let closedAt: number | undefined;
      const finish = (result: Outcome) => {
        clearInterval(poll);
        this.appWindow.removeEventListener("message", onMessage);
        resolve(result);
      };
      const onMessage = (event: MessageEvent) => {
        if (event.source !== popup || !isAppleOrigin(event.origin)) return;
        const data: unknown = event.data;
        if (typeof data !== "object" || data === null) return;
        const session = (data as { ckSession?: unknown }).ckSession;
        if (isSession(session)) {
          this.session = session;
          finish("signed-in");
        } else if ("errorMessage" in data) {
          finish("failed");
        }
      };
      const poll = setInterval(() => {
        if (this.disposed) return finish("cancelled");
        if (Date.now() - startedAt > SIGN_IN_TIMEOUT_MS) return finish("timeout");
        let closed: boolean;
        try {
          closed = popup.closed;
        } catch {
          closed = false;
        }
        if (!closed) return;
        closedAt ??= Date.now();
        if (Date.now() - closedAt > POPUP_CLOSED_GRACE_MS) finish("cancelled");
      }, POPUP_CLOSED_POLL_MS);
      this.appWindow.addEventListener("message", onMessage);
    });
    try {
      if (!popup.closed) popup.close();
    } catch {
      /* Cross-origin popup cleanup is best effort. */
    }

    if (this.disposed) return Result.err({ code: "icloud_sign_in_cancelled" });
    switch (outcome) {
      case "cancelled":
        return Result.err({ code: "icloud_sign_in_cancelled" });
      case "failed":
      case "timeout":
        LOGGER.warn("identity.apple.icloud.failed", { stage: "sign_in", code: outcome });
        return Result.err({ code: "icloud_sign_in_failed" });
      case "signed-in":
        return this.confirmSession();
    }
  }

  /** Asks CloudKit whose session this is, as CloudKit JS does, before using it. */
  private async confirmSession(): Promise<ResultType<CloudKitDatabase, ICloudConnectionError>> {
    try {
      const response = await this.request("public", "users/caller");
      if (response.status === 200) return Result.ok(this.database());
      LOGGER.warn("identity.apple.icloud.failed", {
        stage: "confirm_session",
        httpStatus: response.status,
        code: cloudKitErrorCode(response.body),
      });
    } catch (e) {
      LOGGER.warn("identity.apple.icloud.failed", {
        stage: "confirm_session",
        ...safeErrorLogFields(e),
      });
    }
    this.session = undefined;
    return Result.err({ code: "icloud_sign_in_failed" });
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
    let query = `?ckAPIToken=${encodeURIComponent(apiToken)}`;
    if (this.session) query += `&ckWebAuthToken=${encodeURIComponent(this.session)}`;
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
    if (this.session && !this.disposed) {
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
