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
