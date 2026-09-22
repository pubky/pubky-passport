/**
 * Internal diagnostics for a completed HTTP request that returned an unsuccessful response.
 *
 * The bounded response body is retained for debugging but must never be copied into logs,
 * rendered output, or another externally visible error message.
 */
export class HttpResponseError extends Error {
  readonly status!: number;
  readonly statusText!: string;
  readonly responseBody!: string | "too_large" | null;

  /**
   * @param responseBody Bounded raw body, `too_large` when it exceeded policy,
   * or `null` when no diagnostic body could be retained.
   * @param options Standard error options used to preserve an underlying read or parse cause.
   */
  constructor(
    status: number,
    statusText: string,
    responseBody: string | "too_large" | null,
    options?: ErrorOptions,
  ) {
    super(`HTTP request failed with status ${status}.`, options);
    this.name = "HttpResponseError";
    Object.defineProperties(this, {
      status: { value: status, enumerable: false },
      statusText: { value: statusText, enumerable: false },
      responseBody: { value: responseBody, enumerable: false },
    });
  }
}
