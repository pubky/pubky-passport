import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "@fontsource-variable/inter-tight";
import "./globals.css";
import { EARLY_AUTHORIZATION_LOCATION_SCRIPT } from "../libs/authorization/earlyAuthorizationLocation";
import { EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT } from "../libs/authorization/earlyGoogleImplicitResponse";
import { PassportLogo } from "../client/ui/shared/brand/passportLogo";

export const METADATA: Metadata = {
  title: "Pubky Passport",
  description: "Google-backed Pubky Passport authorization app.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html lang="en">
      <head>
        <script>{EARLY_AUTHORIZATION_LOCATION_SCRIPT}</script>
        <script>{EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT}</script>
      </head>
      <body>
        <header className="flex h-[84px] w-full items-center justify-between bg-[linear-gradient(180deg,rgba(5,5,10,0.96),rgba(5,5,10,0))] px-6">
          <PassportLogo />
        </header>
        {children}
      </body>
    </html>
  );
}
