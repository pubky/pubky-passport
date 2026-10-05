import { isAttemptId } from "../shared/attemptId.js";

/** What this tab keeps for a same-tab sign-in: the SDK's delegated save and where it went. */
export interface RedirectRecord {
  readonly v: 1;
  readonly attemptId: string;
  /** The fingerprint of the client that saved it; only that client resumes it. */
  readonly client: string;
  /** The SDK's delegated save: no key, but the relay secret, so it lives at most 30 minutes. */
  readonly state: string;
  /** The Passport origin the request went to. */
  readonly instance: string;
  readonly createdAt: number;
}

/** Structure only: callers check ownership, the instance, age and the return marker. */
export function parseRedirectRecord(raw: string): RedirectRecord | undefined {
  try {
    const record: unknown = JSON.parse(raw);
    if (
      record === null ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      Object.keys(record).sort().join() !== "attemptId,client,createdAt,instance,state,v"
    )
      return undefined;
    const value = record as Record<string, unknown>;
    if (
      value.v !== 1 ||
      !isAttemptId(value.attemptId) ||
      typeof value.client !== "string" ||
      typeof value.state !== "string" ||
      value.state.length === 0 ||
      typeof value.instance !== "string" ||
      typeof value.createdAt !== "number" ||
      !Number.isSafeInteger(value.createdAt) ||
      value.createdAt < 0
    )
      return undefined;
    return Object.freeze({
      v: 1,
      attemptId: value.attemptId,
      client: value.client,
      state: value.state,
      instance: value.instance,
      createdAt: value.createdAt,
    });
  } catch {
    // Malformed persisted state never exposes the saved SDK state.
    return undefined;
  }
}
