import "client-only";

import { Result } from "better-result";

export type SignupRequest = Readonly<{ callback: string; state: string; clientOrigin: string }>;

/** Only invite-return metadata is accepted. This entry point never accepts a client grant. */
export function parseSignupRequest(hash: string, search: string) {
  const invalid = () => Result.err({ code: "invalid_signup_request" as const });
  if (search || hash.length > 4096) return invalid();
  if (!hash) return Result.ok<SignupRequest | null>(null);
  const parameters = new URLSearchParams(hash.slice(1));
  if ([...parameters.keys()].some((key) => key !== "callback" && key !== "state")) return invalid();
  if (parameters.getAll("callback").length !== 1 || parameters.getAll("state").length !== 1)
    return invalid();
  const callback = parameters.get("callback")!;
  const state = parameters.get("state")!;
  if (callback.length > 2048 || !/^[A-Za-z0-9_-]{16,128}$/.test(state)) return invalid();
  try {
    const url = new URL(callback);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return invalid();
    return Result.ok<SignupRequest | null>(
      Object.freeze({ callback: url.href, state, clientOrigin: url.origin }),
    );
  } catch {
    return invalid();
  }
}
