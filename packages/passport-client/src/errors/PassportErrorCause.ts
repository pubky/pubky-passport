import type { PubkyErrorName } from "@synonymdev/pubky";

const SDK_NAMES: readonly string[] = [
  "RequestError",
  "InvalidInput",
  "AuthenticationError",
  "PkarrError",
  "ClientStateError",
  "InternalError",
];

export function safeSdkFailure(input: unknown): {
  name: PubkyErrorName | "UnknownError";
  statusCode?: number;
  duplicate: boolean;
} {
  try {
    if (!input || typeof input !== "object") return { name: "UnknownError", duplicate: false };
    const value = input as Record<string, unknown>;
    const rawName = value.name === "PassportErrorCause" ? value.message : value.name;
    const name =
      typeof rawName === "string" && SDK_NAMES.includes(rawName)
        ? (rawName as PubkyErrorName)
        : "UnknownError";
    const data =
      value.data && typeof value.data === "object"
        ? (value.data as Record<string, unknown>)
        : value;
    const statusCode = data.statusCode;
    return {
      name,
      ...(typeof statusCode === "number" &&
      Number.isInteger(statusCode) &&
      statusCode >= 100 &&
      statusCode <= 599
        ? { statusCode }
        : {}),
      duplicate:
        typeof value.message === "string" &&
        /expected instance of (?:AuthFlowKind|Pubky|GrantAuthFlow|Session)\b/u.test(value.message),
    };
  } catch {
    return { name: "UnknownError", duplicate: false };
  }
}

export class PassportErrorCause extends Error {
  override readonly name = "PassportErrorCause";
  override readonly message: PubkyErrorName | "UnknownError";
  readonly statusCode?: number;

  constructor(input: unknown) {
    const safe = safeSdkFailure(input);
    super(safe.name);
    this.message = safe.name;
    if (safe.statusCode !== undefined) this.statusCode = safe.statusCode;
    Object.freeze(this);
  }
}
