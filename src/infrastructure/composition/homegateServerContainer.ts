import { createRequestGoogleHomegateInviteUseCase } from "../../core/application/homegate/requestGoogleHomegateInvite";
import { createRequestGoogleHomegateInviteController } from "../../core/controllers/homegate/requestGoogleHomegateInviteController";
import { getHomegateInviteServerEnv } from "../../libs/env/server";
import { ServerHomegateGoogleInviteClient } from "../server/providers/google/homegateGoogleInviteClient";

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
