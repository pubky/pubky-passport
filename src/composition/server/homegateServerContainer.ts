import "server-only";

import { createRequestGoogleHomegateInviteUseCase } from "../../core/homegate/requestGoogleHomegateInvite";
import { createRequestGoogleHomegateInviteController } from "../../core/homegate/requestGoogleHomegateInviteController";
import { getHomegateInviteServerEnv } from "../../libs/env/server";
import { ServerHomegateGoogleInviteClient } from "../../adapters/server/homegate/homegateGoogleInviteClient";

// Composition is the sole server wiring point for this route's core flow and adapter.

export function createHomegateInviteRequestController() {
  const env = getHomegateInviteServerEnv();

  return createRequestGoogleHomegateInviteController(
    createRequestGoogleHomegateInviteUseCase({
      homegateInvite: new ServerHomegateGoogleInviteClient({
        homegateUrl: env.HOMEGATE_URL,
      }),
    }),
  );
}
