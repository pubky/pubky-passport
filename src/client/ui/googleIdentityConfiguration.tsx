"use client";

import { createContext, type ReactNode, useContext } from "react";

import type { GoogleIdentityConfiguration } from "../logic/google-identity/GoogleIdentityController";

const GoogleIdentityConfigurationContext = createContext<GoogleIdentityConfiguration | null>(null);

function GoogleIdentityConfigurationProvider({ children, configuration }: {
  children: ReactNode;
  configuration: GoogleIdentityConfiguration;
}) {
  return (
    <GoogleIdentityConfigurationContext value={configuration}>
      {children}
    </GoogleIdentityConfigurationContext>
  );
}

function useGoogleIdentityConfiguration(): GoogleIdentityConfiguration {
  const configuration = useContext(GoogleIdentityConfigurationContext);
  if (!configuration) {
    throw new Error("Google identity configuration is unavailable.");
  }
  return configuration;
}

export { GoogleIdentityConfigurationProvider, useGoogleIdentityConfiguration };
