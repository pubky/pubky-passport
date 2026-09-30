import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import { readBoundedText } from "@/libs/http/boundedBody";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { REQUEST_TIMEOUT_MS } from "@/libs/passportPolicy";

/**
 * What the homeserver says about an invite before it is submitted. `unknown` covers transport,
 * resolution, and unexpected responses, and alone never proves an invite bad: on `unknown` a
 * caller may stop only when the {@link SignupTokenLookup} says `reached === false`, meaning the
 * homeserver sent no response and a request made right after would not reach it either.
 */
export type SignupTokenStatus = "valid" | "used" | "not_found" | "unknown";

/**
 * A lookup's {@link SignupTokenStatus} and whether the homeserver answered at all. `reached` is
 * false only when no HTTP response arrived (resolution, transport, timeout, or cancellation), so
 * a request sent right after would not have reached it either.
 */
export type SignupTokenLookup = { status: SignupTokenStatus; reached: boolean };

type HomeserverFetch = (url: string, init: RequestInit) => Promise<Response>;

/** The documented client answer: `{ status: "valid" | "used", created_at }`. */
const tokenStatusSchema = z.object({ status: z.enum(["valid", "used"]) });

/** Loads the SDK only for the first lookup, so the pages render without it. */
const fetchHomeserver: HomeserverFetch = async (url, init) =>
  (await import("./PubkySdkAdapter")).fetchHomeserver(url, init);

/**
 * A well-formed code asked about only to learn whether a homeserver answers. Any answer, even
 * "not found", proves the homeserver's record resolves and the homeserver is up.
 */
const REACHABILITY_PROBE_TOKEN = "0000-0000-0000";

/** Read-only lookup of `GET /signup_tokens/{token}`; it never consumes the invite. */
export class SignupTokenChecker {
  constructor(private readonly fetch: HomeserverFetch = fetchHomeserver) {}

  async check(invite: HomeserverSignupDetails, signal: AbortSignal): Promise<SignupTokenStatus> {
    return (await this.lookUp(invite, signal)).status;
  }

  /**
   * Whether the homeserver answers at all, by the same read-only lookup made for a code nobody
   * holds. `false` covers a key with no record, a homeserver that is down, and a timeout.
   */
  async reaches(homeserverPubky: string, signal: AbortSignal): Promise<boolean> {
    const lookup = await this.lookUp(
      { homeserverPubky, signupToken: REACHABILITY_PROBE_TOKEN },
      signal,
    );
    return lookup.reached;
  }

  async lookUp(invite: HomeserverSignupDetails, signal: AbortSignal): Promise<SignupTokenLookup> {
    const url = `https://${invite.homeserverPubky}/signup_tokens/${encodeURIComponent(invite.signupToken)}`;
    let response: Response;
    try {
      response = await this.fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
    } catch (e) {
      if (!signal.aborted) {
        LOGGER.warn("signup.invite_check.failed", { stage: "request", ...safeErrorLogFields(e) });
      }
      return { status: "unknown", reached: false };
    }
    return { status: await readTokenStatus(response, signal), reached: true };
  }
}

async function readTokenStatus(
  response: Response,
  signal: AbortSignal,
): Promise<SignupTokenStatus> {
  if (response.status === 404) return "not_found";
  if (!response.ok) {
    LOGGER.warn("signup.invite_check.failed", { httpStatus: response.status });
    return "unknown";
  }
  try {
    const body = await readBoundedText(response, 4096);
    if (Result.isError(body)) return signal.aborted ? "unknown" : unexpectedAnswer("response_read");
    return parseTokenStatus(body.value) ?? unexpectedAnswer("response_validation");
  } catch (e) {
    if (!signal.aborted) LOGGER.warn("signup.invite_check.failed", safeErrorLogFields(e));
    return "unknown";
  }
}

function parseTokenStatus(body: string): "valid" | "used" | null {
  try {
    const parsed = tokenStatusSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data.status : null;
  } catch {
    return null;
  }
}

/** An unreadable or undocumented 200 proves nothing about the invite, in either direction. */
function unexpectedAnswer(stage: "response_read" | "response_validation"): "unknown" {
  LOGGER.warn("signup.invite_check.failed", { stage });
  return "unknown";
}
