import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "@fontsource-variable/inter-tight";
import "./globals.css";
import { GoogleIdentityConfigurationProvider } from "../client/ui/googleIdentityConfiguration";
import { PassportLogo } from "../client/ui/shared/brand/passportLogo";
import { Sonner } from "../client/ui/shared/sonner";
import { LOGGER } from "../libs/logger/logger";
import { getBrowserBootstrapConfig } from "../server/config/browserBootstrapConfig";
import { ParserTimeScripts } from "./parserTimeScripts";

export const metadata: Metadata = {
  title: "Pubky Passport",
  description: "Google-backed Pubky Passport authorization app.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  let config: ReturnType<typeof getBrowserBootstrapConfig>;
  try {
    config = getBrowserBootstrapConfig();
  } catch {
    LOGGER.error("layout.bootstrap.failed", {
      layer: "layout",
      operation: "bootstrap",
      stage: "configuration",
      code: "invalid_configuration",
    });
    throw new Error("Application configuration unavailable.");
  }

  return (
    <html lang="en">
      <head>
        <ParserTimeScripts />
      </head>
      <body>
        <header className="flex h-[var(--passport-header-height)] w-full items-center justify-between bg-[linear-gradient(180deg,rgba(5,5,10,0.96),rgba(5,5,10,0))] px-6">
          <PassportLogo />
        </header>
        <GoogleIdentityConfigurationProvider
          googleClientId={config.googleClientId}
          homegateBaseUrl={config.homegateBaseUrl}
        >
          {children}
        </GoogleIdentityConfigurationProvider>
        <Sonner />
      </body>
    </html>
  );
}
