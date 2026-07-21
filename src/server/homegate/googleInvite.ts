import "server-only";

import { createRequestGoogleHomegateInviteUseCase } from "./requestGoogleHomegateInvite";
import { createRequestGoogleHomegateInviteController } from "./requestGoogleHomegateInviteController";
import { getHomegateInviteServerEnv } from "../../libs/env/server";
import { ServerHomegateGoogleInviteClient } from "./google/homegateGoogleInviteClient";

// Composition is the sole server wiring point for this route's feature flow and adapter.

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
