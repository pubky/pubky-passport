import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "@fontsource-variable/inter-tight";
import "./globals.css";
import { PassportLogo } from "../client/ui/shared/brand/passportLogo";
import { Sonner } from "../client/ui/shared/sonner";
import { ParserTimeScripts } from "./parserTimeScripts";

export const metadata: Metadata = {
  title: "Pubky Passport",
  description: "Google-backed Pubky Passport authorization app.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html lang="en">
      <head>
        <ParserTimeScripts />
      </head>
      <body>
        <header className="flex h-[84px] w-full items-center justify-between bg-[linear-gradient(180deg,rgba(5,5,10,0.96),rgba(5,5,10,0))] px-6">
          <PassportLogo />
        </header>
        {children}
        <Sonner />
      </body>
    </html>
  );
}
