"use client";

import { createContext, type ReactNode, useContext } from "react";

/** Public Apple settings, or `null` when Apple login is off. */
export type AppleClientConfiguration = Readonly<{
  servicesId: string;
  cloudKitContainerId: string;
  cloudKitApiToken: string;
  cloudKitEnvironment: "production" | "development";
}> | null;

const AppleIdentityConfigurationContext = createContext<AppleClientConfiguration>(null);

function AppleIdentityConfigurationProvider({
  apple,
  children,
}: {
  apple: AppleClientConfiguration;
  children: ReactNode;
}) {
  return (
    <AppleIdentityConfigurationContext value={apple}>{children}</AppleIdentityConfigurationContext>
  );
}

/** Apple login settings; `null` hides every Apple control. */
function useAppleIdentityConfiguration(): AppleClientConfiguration {
  return useContext(AppleIdentityConfigurationContext);
}

export { AppleIdentityConfigurationProvider, useAppleIdentityConfiguration };
