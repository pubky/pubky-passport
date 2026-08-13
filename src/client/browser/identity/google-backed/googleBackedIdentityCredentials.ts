import "client-only";

import type { GoogleAccountProfile } from "../googleAccountProfile";

export type GoogleBackedIdentityCredentials = {
  googleIdToken: string;
  driveAccessToken: string;
  googleAccount: GoogleAccountProfile;
};
