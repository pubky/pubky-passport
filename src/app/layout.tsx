import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "@fontsource-variable/inter-tight";
import "./globals.css";
import { GoogleIdentityConfigurationProvider } from "@/client/ui/googleIdentityConfiguration";
import { HomegateAvailabilityProvider } from "@/client/ui/homegateAvailability";
import { PassportLogo } from "@/client/ui/shared/brand/passportLogo";
import { PassportFooter } from "@/client/ui/shared/passportFooter";
import { PassportHeaderActionSlot } from "@/client/ui/shared/passportHeaderAction";
import { TestnetBadge } from "@/client/ui/shared/testnetBadge";
import { PUBKY_NETWORK_META_NAME } from "@/libs/pubkyNetwork";
import { Sonner } from "@/client/ui/shared/sonner";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { getPublicEnvironment } from "@/server/environment";
import { PassportProviderConfiguration } from "@/client/ui/passportProviderConfiguration";
import { ParserTimeScripts } from "./parserTimeScripts";

export const metadata: Metadata = {
  title: "Pubky Passport",
  description: "Your keychain for the web.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  let config: ReturnType<typeof getPublicEnvironment>;
  try {
    config = getPublicEnvironment();
  } catch (e) {
    LOGGER.error("layout.bootstrap.failed", {
      layer: "layout",
      operation: "bootstrap",
      stage: "configuration",
      code: "invalid_configuration",
      ...safeErrorLogFields(e),
    });
    throw new Error("Application configuration unavailable.", { cause: e });
  }
  const { instance } = config;

  return (
    <html lang="en">
      <head>
        {/* Read before hydration by the request entry, which refuses another network's request. */}
        <meta content={instance.network.network} name={PUBKY_NETWORK_META_NAME} />
        <ParserTimeScripts />
      </head>
      <body>
        <header className="flex h-[calc(var(--passport-header-height)+var(--passport-context-band-height))] min-h-[calc(var(--passport-header-height)+var(--passport-context-band-height))] w-full shrink-0 items-center justify-between gap-3 bg-[linear-gradient(180deg,rgba(5,5,10,0.96),rgba(5,5,10,0))] px-6 pt-[var(--passport-context-band-height)] min-[64.0625rem]:px-10">
          <div className="flex min-w-0 flex-col">
            {instance.network.network === "testnet" ? (
              <div className="flex items-center gap-3">
                <PassportLogo />
                <TestnetBadge network="testnet" />
              </div>
            ) : (
              <PassportLogo />
            )}
          </div>
          <PassportHeaderActionSlot />
        </header>
        <PassportProviderConfiguration value={instance}>
          <GoogleIdentityConfigurationProvider
            googleClientId={config.googleClientId}
            homegateBaseUrl={config.homegateBaseUrl}
          >
            <HomegateAvailabilityProvider>{children}</HomegateAvailabilityProvider>
          </GoogleIdentityConfigurationProvider>
        </PassportProviderConfiguration>
        <PassportFooter />
        <Sonner />
      </body>
    </html>
  );
}
