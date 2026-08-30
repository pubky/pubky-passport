import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "@fontsource-variable/inter-tight";
import "./globals.css";
import { GoogleIdentityConfigurationProvider } from "../client/ui/googleIdentityConfiguration";
import { BrandEndorsement } from "../client/ui/shared/brand/brandEndorsement";
import { PassportLogo } from "../client/ui/shared/brand/passportLogo";
import { Sonner } from "../client/ui/shared/sonner";
import { LOGGER, safeErrorLogFields } from "../libs/logger/logger";
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
  } catch (cause) {
    LOGGER.error("layout.bootstrap.failed", {
      layer: "layout",
      operation: "bootstrap",
      stage: "configuration",
      code: "invalid_configuration",
      ...safeErrorLogFields(cause),
    });
    throw new Error("Application configuration unavailable.", { cause });
  }

  return (
    <html lang="en">
      <head>
        <ParserTimeScripts />
      </head>
      <body>
        <header className="flex h-[var(--passport-header-height)] min-h-[var(--passport-header-height)] w-full shrink-0 items-center justify-between bg-[linear-gradient(180deg,rgba(5,5,10,0.96),rgba(5,5,10,0))] px-6 md:px-10">
          <PassportLogo />
        </header>
        <GoogleIdentityConfigurationProvider
          googleClientId={config.googleClientId}
          homegateBaseUrl={config.homegateBaseUrl}
        >
          {children}
        </GoogleIdentityConfigurationProvider>
        <footer className="passport-footer pointer-events-none fixed inset-x-0 bottom-0 z-10 hidden h-[72px] items-center px-10 md:flex">
          <BrandEndorsement />
        </footer>
        <Sonner />
      </body>
    </html>
  );
}
