import "client-only";

import type { GoogleAccountProfile } from "../../../core/identity/googleAccountProfile";

export type GoogleBackedIdentityCredentials = {
  googleIdToken: string;
  driveAccessToken: string;
  googleAccount?: GoogleAccountProfile;
};
