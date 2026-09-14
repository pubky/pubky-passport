import type { ReactNode } from "react";

import { GoogleIdentityConfigurationProvider } from "../src/client/ui/googleIdentityConfiguration";
import {
  PassportCollaboratorsProvider,
  type PassportCollaborators,
} from "../src/client/ui/passportCollaborators";

const TEST_GOOGLE_IDENTITY_CONFIGURATION = {
  googleClientId: "google-client-id",
  homegateBaseUrl: "https://homegate.example/",
};

export function withGoogleIdentityConfiguration(children: ReactNode) {
  return (
    <GoogleIdentityConfigurationProvider {...TEST_GOOGLE_IDENTITY_CONFIGURATION}>
      {children}
    </GoogleIdentityConfigurationProvider>
  );
}

export function withPassportTestProviders(
  children: ReactNode,
  collaborators: Partial<PassportCollaborators> = {},
) {
  return (
    <PassportCollaboratorsProvider value={collaborators}>
      {withGoogleIdentityConfiguration(children)}
    </PassportCollaboratorsProvider>
  );
}
