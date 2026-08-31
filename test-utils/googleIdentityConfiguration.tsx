import type { ReactNode } from "react";

import { GoogleIdentityConfigurationProvider } from "../src/client/ui/googleIdentityConfiguration";

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
