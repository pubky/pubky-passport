import "client-only";

import { Result } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";

/** Starts a homeserver republish that never rejects and must not be awaited on a user path. */
export function startHomeserverRepublish(
  publish: () => Promise<Result<void, CodedFailure<string>>>,
): Promise<void> {
  try {
    return Promise.resolve(publish())
      .then((result) => {
        if (Result.isError(result)) {
          LOGGER.warn("identity.homeserver.republish.failed", {
            code: result.error.code,
            ...safeErrorLogFields(result.error),
          });
        }
      })
      .catch((e: unknown) => {
        logRepublishFailure(e);
      });
  } catch (e) {
    logRepublishFailure(e);
    return Promise.resolve();
  }
}

function logRepublishFailure(e: unknown): void {
  LOGGER.warn("identity.homeserver.republish.failed", {
    code: "unexpected_failure",
    ...safeErrorLogFields(e),
  });
}
