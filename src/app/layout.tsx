import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "@fontsource-variable/inter-tight";
import "./globals.css";
import { AppHeader } from "../ui/layout/app-header";

export const METADATA: Metadata = {
  title: "Pubky Passport",
  description: "Google-backed Pubky Passport authorization app.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html lang="en">
      <body><AppHeader />{children}</body>
    </html>
  );
}
