import type { AttemptController } from "../src/attempt/AttemptController.js";
import type { AttemptEvent } from "../src/attempt/attemptModel.js";
import type { AttemptResult } from "../src/client/AttemptResult.js";

/** What the facade does in a click: reserve the result, then start the attempt. */
export function startAttempt(
  controller: AttemptController,
  event: Extract<AttemptEvent, { type: "SIGN_IN" }>,
): Promise<AttemptResult> {
  const pending = controller.reserveResult();
  controller.dispatch(event);
  return pending;
}
