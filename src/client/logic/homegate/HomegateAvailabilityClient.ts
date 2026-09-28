import "client-only";

import { Result } from "better-result";
import { z } from "zod";
import { readBoundedText } from "@/libs/http/boundedBody";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { REQUEST_TIMEOUT_MS } from "@/libs/passportPolicy";
import { homegateRequestInit } from "./HomegateTransport";

export type VerificationMethod = "sms" | "lightning" | "google";
export type MethodAvailability = {
  status: "checking" | "available" | "unavailable" | "blocked" | "unknown";
  httpStatus?: number;
  amountSat?: number;
};
export type VerificationAvailability = Record<VerificationMethod, MethodAvailability>;

const PROBES = {
  sms: { path: "/sms_verification/info", availableStatus: 200 },
  lightning: { path: "/ln_verification/info", availableStatus: 200 },
  // Google has no /info endpoint. GET on its POST-only route is a read-only mount probe.
  google: { path: "/google_verification", availableStatus: 405 },
} as const;
const lightningInfo = z.object({
  amountSat: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

/** Browser-side probes preserve the caller's region; they never send SMS or create invoices. */
export class HomegateAvailabilityClient {
  constructor(
    private readonly homegateBaseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  async check(method: VerificationMethod, signal: AbortSignal): Promise<MethodAvailability> {
    const probe = PROBES[method];
    try {
      const response = await this.fetch(
        new URL(probe.path, this.homegateBaseUrl),
        homegateRequestInit(
          AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          "GET",
        ),
      );
      const httpStatus = response.status;
      if (method === "lightning" && httpStatus === 200) {
        const text = await readBoundedText(response, 1024);
        if (Result.isError(text)) return { status: "unknown", httpStatus };
        try {
          const parsed = lightningInfo.safeParse(JSON.parse(text.value));
          return parsed.success
            ? { status: "available", httpStatus, amountSat: parsed.data.amountSat }
            : { status: "unknown", httpStatus };
        } catch {
          return { status: "unknown", httpStatus };
        }
      }
      // SMS's success body is empty; Google needs only the route's HTTP status.
      void response.body?.cancel().catch(() => undefined);
      if (httpStatus === probe.availableStatus) return { status: "available", httpStatus };
      if (httpStatus === 403) return { status: "blocked", httpStatus };
      if (httpStatus === 404) return { status: "unavailable", httpStatus };
      return { status: "unknown", httpStatus };
    } catch (e) {
      if (!signal.aborted) {
        LOGGER.warn("signup.homegate.availability.failed", {
          method,
          ...safeErrorLogFields(e),
        });
      }
      // CORS, offline, timeout, and transport failures cannot establish a geographic block.
      return { status: "unknown" };
    }
  }
}
