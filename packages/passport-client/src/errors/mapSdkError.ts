import {
  PassportError,
  type PassportErrorCode,
  type PassportErrorOptions,
} from "./PassportError.js";
import { safeSdkFailure } from "./PassportErrorCause.js";

export function mapSdkError(
  input: unknown,
  stage: "start" | "poll",
  options: Omit<PassportErrorOptions, "cause" | "detail"> = {},
): { error: PassportError; diagnostic?: "sdk_duplicate_suspected" } {
  const safe = safeSdkFailure(input);
  const code: PassportErrorCode =
    safe.name === "RequestError"
      ? "network"
      : stage === "poll" && safe.name === "PkarrError"
        ? "identity_unresolved"
        : stage === "poll" && safe.name === "AuthenticationError"
          ? "approval_rejected"
          : "internal";
  return {
    error: new PassportError(code, {
      ...options,
      cause: {
        name: safe.name,
        ...(safe.statusCode !== undefined ? { statusCode: safe.statusCode } : {}),
      },
      ...(safe.name !== "UnknownError" || safe.statusCode !== undefined
        ? {
            detail: {
              ...(safe.name !== "UnknownError" ? { sdkError: safe.name } : {}),
              ...(safe.statusCode !== undefined ? { statusCode: safe.statusCode } : {}),
            },
          }
        : {}),
    }),
    ...(safe.duplicate ? { diagnostic: "sdk_duplicate_suspected" as const } : {}),
  };
}
