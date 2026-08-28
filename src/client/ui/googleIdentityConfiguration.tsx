"use client";

import { createContext, type ReactNode, useContext } from "react";

const GoogleIdentityConfigurationContext = createContext<{
  googleClientId: string;
  homegateBaseUrl: string;
} | null>(null);

function GoogleIdentityConfigurationProvider({
  children,
  googleClientId,
  homegateBaseUrl,
}: {
  children: ReactNode;
  googleClientId: string;
  homegateBaseUrl: string;
}) {
  return (
    <GoogleIdentityConfigurationContext value={{ googleClientId, homegateBaseUrl }}>
      {children}
    </GoogleIdentityConfigurationContext>
  );
}

function useGoogleIdentityConfiguration() {
  const configuration = useContext(GoogleIdentityConfigurationContext);
  if (!configuration) {
    throw new Error("Google identity configuration is unavailable.");
  }
  return configuration;
}

export { GoogleIdentityConfigurationProvider, useGoogleIdentityConfiguration };
