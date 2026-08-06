import { GoogleAuthorizationCodeExchange } from "../../../../server/google-authorization/googleAuthorizationCodeExchange";
import { getGoogleOAuthClientConfig } from "../../../../server/config/googleOAuthClient";
import { createGoogleAuthorizationHandler } from "./handler";

export const POST = createGoogleAuthorizationHandler(() => new GoogleAuthorizationCodeExchange(getGoogleOAuthClientConfig()));
