import "client-only";

import { Result } from "better-result";
import type { z } from "zod";

import { readBoundedText } from "@/libs/http/boundedBody";
import { HttpResponseError } from "@/libs/http/HttpResponseError";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { MAXIMUM_JSON_BODY_BYTES, REQUEST_TIMEOUT_MS } from "@/libs/passportPolicy";
import type { CodedFailure } from "@/libs/result";
import { refusesHomeserver } from "./homegateSignup";

type TransportErrorCode =
  | "network_failed"
  | "homegate_unavailable"
  | "malformed_homegate_response"
  /** A signup code arrived without a valid homeserver, so there is nowhere it can be used. */
  | "invalid_homegate_homeserver";
export type HomegateFailure<Code extends string> = CodedFailure<Code | TransportErrorCode> & {
  httpStatus?: number;
};

const MAXIMUM_ERROR_BODY_BYTES = 256;

/**
 * Fetch options for every Homegate request. Credentials go to Passport's own origin only: a
 * Homegate on another origin never receives a cookie, while one served under Passport's own
 * origin (`HOMEGATE_URL` below it, behind the same login proxy) gets that origin's cookies, as any
 * same-origin request does. Bodiless requests omit `Content-Type`, so GET probes and polls stay
 * simple CORS requests without a preflight.
 */
export function homegateRequestInit(
  signal: AbortSignal,
  method: "GET" | "POST",
  body?: unknown,
): RequestInit {
  const accept = "application/json, text/plain";
  return {
    method,
    headers:
      body === undefined
        ? { Accept: accept }
        : { Accept: accept, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  };
}

/** Bounded Homegate requests, never credentialed cross-origin; bodies stay out of logs and UI. */
export class HomegateTransport<Code extends string> {
  private readonly baseUrl: URL;

  /**
   * @param mapError Maps a non-OK response to a domain code. `body` is null when the error body
   * could not be read, for example a proxy page over the size limit; the status still counts.
   * @throws {TypeError} when the Homegate base URL is invalid.
   */
  constructor(
    homegateBaseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
    private readonly event: string,
    private readonly mapError: (body: string | null, status: number) => Code,
  ) {
    this.baseUrl = new URL(homegateBaseUrl);
  }

  async request<T>(
    path: string,
    operation: string,
    schema: z.ZodType<T>,
    options: {
      body?: unknown;
      method?: "GET" | "POST";
      signal?: AbortSignal;
      empty?: boolean;
    } = {},
  ): Promise<Result<T, HomegateFailure<Code>>> {
    let signal: AbortSignal;
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      response = await this.fetch(
        homegateUrl(path, this.baseUrl),
        homegateRequestInit(signal, options.method ?? "POST", options.body),
      );
    } catch (e) {
      return this.failure(operation, "request", { code: "network_failed", cause: e });
    }

    if (response.ok && options.empty) {
      // send_code has an empty 200 response, not JSON.
      void response.body?.cancel().catch(() => undefined);
      const parsed = schema.safeParse(undefined);
      if (parsed.success) return Result.ok(parsed.data);
    }

    const text = await readBoundedText(
      response,
      response.ok ? MAXIMUM_JSON_BODY_BYTES : MAXIMUM_ERROR_BODY_BYTES,
    );
    if (Result.isError(text)) {
      const code = signal.aborted
        ? "network_failed"
        : response.ok
          ? "malformed_homegate_response"
          : this.mapError(null, response.status);
      return this.failure(operation, "response_read", {
        code,
        httpStatus: response.status,
        cause: text.error.cause,
      });
    }
    if (!response.ok) {
      return this.failure(operation, "error_response", {
        code: this.mapError(text.value, response.status),
        httpStatus: response.status,
        cause: new HttpResponseError(response.status, response.statusText, text.value),
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(text.value);
    } catch (e) {
      return this.failure(operation, "response_parse", {
        code: "malformed_homegate_response",
        httpStatus: response.status,
        cause: new Error("Homegate response must be valid JSON.", { cause: e }),
      });
    }
    const parsed = schema.safeParse(json);
    if (parsed.success) return Result.ok(parsed.data);
    // Zod issues can echo phone numbers or invitations.
    const homeserverRefused = refusesHomeserver(parsed.error.issues);
    return this.failure(operation, "response_validation", {
      code: homeserverRefused ? "invalid_homegate_homeserver" : "malformed_homegate_response",
      httpStatus: response.status,
      cause: new Error(
        homeserverRefused
          ? "Homegate issued a signup code without a valid homeserver public key."
          : "Homegate response does not match the expected schema.",
      ),
    });
  }

  private failure(
    operation: string,
    stage: string,
    failure: HomegateFailure<Code>,
  ): Result<never, HomegateFailure<Code>> {
    LOGGER.warn(this.event, {
      operation,
      stage,
      code: failure.code,
      ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
      ...(failure.cause === undefined ? {} : safeErrorLogFields(failure.cause)),
    });
    return Result.err(failure);
  }
}

/**
 * An API path (`/sms_verification/info`) below Homegate's base, which may itself sit below a path
 * prefix (`https://gateway.example/homegate/`), unlike a plain `new URL(path, base)`.
 */
export function homegateUrl(path: string, base: string | URL): URL {
  const root = new URL(base);
  if (!root.pathname.endsWith("/")) root.pathname = `${root.pathname}/`;
  return new URL(path.replace(/^\/+/u, ""), root);
}
