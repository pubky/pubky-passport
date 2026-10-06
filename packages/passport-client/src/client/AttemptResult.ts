import type { Session } from "@synonymdev/pubky";
import type { SessionInfo } from "../attempt/attemptModel.js";
import type { PassportError } from "../errors/PassportError.js";

export type AttemptResult =
  | { status: "signed-in"; session: Session; info: SessionInfo }
  | { status: "failed"; error: PassportError }
  | { status: "redirecting" };
