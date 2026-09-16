import "client-only";

import { Result } from "better-result";
import type { z } from "zod";

import { readBoundedText } from "@/libs/http/boundedBody";
import { HttpResponseError } from "@/libs/http/HttpResponseError";
import { createFailure } from "@/libs/logger/createFailure";
import { safeErrorLogFields } from "@/libs/logger/logger";
import { MAXIMUM_JSON_BODY_BYTES, REQUEST_TIMEOUT_MS } from "@/libs/passportPolicy";
import type { CodedFailure } from "@/libs/result";

type TransportErrorCode = "network_failed" | "homegate_unavailable" | "malformed_homegate_response";
export type HomegateFailure<Code extends string> = CodedFailure<Code | TransportErrorCode> & {
  httpStatus?: number;
};

/** Bounded, credential-free Homegate requests; response bodies stay out of logs and UI errors. */
export class HomegateTransport<Code extends string> {
  private readonly baseUrl: URL;
  private readonly reportFailure: ReturnType<typeof createFailure<Code | TransportErrorCode>>;

  constructor(
    homegateBaseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
    event: string,
    private readonly mapError: (body: string, status: number) => Code,
  ) {
    this.baseUrl = new URL(homegateBaseUrl);
    this.reportFailure = createFailure<Code | TransportErrorCode>(event);
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
      response = await this.fetch(new URL(path, this.baseUrl), {
        method: options.method ?? "POST",
        headers: { Accept: "application/json, text/plain", "Content-Type": "application/json" },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch (e) {
      return this.failure(operation, "request", { code: "network_failed", cause: e });
    }

    if (response.ok && options.empty) {
      // send_code has an empty 200 response, not JSON.
      void response.body?.cancel().catch(() => undefined);
      const parsed = schema.safeParse(undefined);
      if (parsed.success) return Result.ok(parsed.data);
    }

    const text = await readBoundedText(response, response.ok ? MAXIMUM_JSON_BODY_BYTES : 256);
    if (Result.isError(text)) {
      const code = signal.aborted
        ? "network_failed"
        : response.ok
          ? "malformed_homegate_response"
          : "homegate_unavailable";
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
    return this.failure(operation, "response_validation", {
      code: "malformed_homegate_response",
      httpStatus: response.status,
      cause: new Error("Homegate response does not match the expected schema."),
    });
  }

  private failure(
    operation: string,
    stage: string,
    failure: HomegateFailure<Code>,
  ): Result<never, HomegateFailure<Code>> {
    return this.reportFailure(
      {
        operation,
        stage,
        code: failure.code,
        ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
        ...(failure.cause === undefined ? {} : safeErrorLogFields(failure.cause)),
      },
      failure,
    );
  }
}
