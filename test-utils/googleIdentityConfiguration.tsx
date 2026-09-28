import { Result } from "better-result";
import type { ReactNode } from "react";

import { GoogleIdentityConfigurationProvider } from "@/client/ui/googleIdentityConfiguration";
import { HomegateAvailabilityContext } from "@/client/ui/homegateAvailability";
import {
  PassportCollaboratorsProvider,
  type PassportCollaborators,
} from "@/client/ui/passportCollaborators";
import { PassportProviderConfiguration } from "@/client/ui/passportProviderConfiguration";
import type { PassportProvider } from "@/libs/passportProvider";
import { makeInstanceConfig } from "./instanceConfig";

const TEST_GOOGLE_IDENTITY_CONFIGURATION = {
  googleClientId: "google-client-id",
  homegateBaseUrl: "https://homegate.example/",
};

export function withGoogleIdentityConfiguration(
  children: ReactNode,
  instance: PassportProvider = makeInstanceConfig(),
) {
  return (
    <PassportProviderConfiguration value={instance}>
      <GoogleIdentityConfigurationProvider {...TEST_GOOGLE_IDENTITY_CONFIGURATION}>
        <HomegateAvailabilityContext
          value={{
            methods: {
              google: { status: "available" },
              sms: { status: "available" },
              lightning: { status: "available", amountSat: 10 },
            },
            retry: () => undefined,
          }}
        >
          {children}
        </HomegateAvailabilityContext>
      </GoogleIdentityConfigurationProvider>
    </PassportProviderConfiguration>
  );
}

export function withPassportTestProviders(
  children: ReactNode,
  collaborators: Partial<PassportCollaborators> = {},
  instance?: PassportProvider,
) {
  return (
    <PassportCollaboratorsProvider
      value={{
        createProfileController: () => ({
          load: async () => Result.ok(null),
          save: async () => Result.err({ code: "save_failed" as const }),
        }),
        checkSignupToken: async () => "valid" as const,
        ...collaborators,
      }}
    >
      {withGoogleIdentityConfiguration(children, instance)}
    </PassportCollaboratorsProvider>
  );
}
