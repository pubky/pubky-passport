export { createPassportClient } from "./client/createPassportClient.js";
export type {
  PassportClient,
  PassportError,
  PassportView,
  SignedIn,
  SignInResult,
} from "./client/PassportClient.js";
export type { PassportClientOptions } from "./config/PassportClientOptions.js";
/** Thrown for a bad option; match it by `name` and read its `issues`. */
export type { ConfigIssue, PassportConfigError } from "./config/PassportConfigError.js";
export type { PassportErrorCode } from "./errors/PassportError.js";
export type {
  MessageKey,
  PassportMessageOverrides as PassportMessages,
} from "./errors/messageTypes.js";
export type { PassportProfile } from "./profile/PassportProfile.js";
