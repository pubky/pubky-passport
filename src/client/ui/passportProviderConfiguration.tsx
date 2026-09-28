"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { PassportProvider } from "@/libs/passportProvider";

// No default: a screen rendered outside the layout must fail, never assume every feature is on.
const Context = createContext<PassportProvider | null>(null);

export function PassportProviderConfiguration({
  children,
  value,
}: {
  children: ReactNode;
  value: PassportProvider;
}) {
  return <Context value={value}>{children}</Context>;
}

/** @throws {Error} outside `PassportProviderConfiguration`. */
export function usePassportProvider(): PassportProvider {
  const provider = useContext(Context);
  if (!provider) throw new Error("Passport provider configuration is unavailable.");
  return provider;
}

export function ProviderTerms() {
  const provider = usePassportProvider();
  if (!provider.termsUrl && !provider.privacyUrl) return null;
  return (
    <p className="text-sm leading-5 text-muted-foreground">
      Homeserver provider:{" "}
      {provider.termsUrl ? (
        <a
          className="text-brand underline-offset-4 hover:underline"
          href={provider.termsUrl}
          target="_blank"
          rel="noreferrer"
        >
          Terms of service
        </a>
      ) : null}
      {provider.termsUrl && provider.privacyUrl ? " · " : null}
      {provider.privacyUrl ? (
        <a
          className="text-brand underline-offset-4 hover:underline"
          href={provider.privacyUrl}
          target="_blank"
          rel="noreferrer"
        >
          Privacy policy
        </a>
      ) : null}
    </p>
  );
}
