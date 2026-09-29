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

const WHOSE = "of the homeserver provider (opens in a new tab)";
const PROVIDER_LINK_CLASS_NAME =
  "rounded-sm font-medium text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand";

/**
 * The homeserver provider's own legal documents. The links are underlined, since colour alone
 * does not mark them in a sentence, and their accessible names say whose documents they are,
 * because Passport's own Terms of Service and Privacy Policy sit in the footer. Each name starts
 * with the visible text, so voice control finds the link by what it shows.
 */
export function ProviderTerms() {
  const provider = usePassportProvider();
  if (!provider.termsUrl && !provider.privacyUrl) return null;
  return (
    <p className="text-sm leading-5 text-muted-foreground">
      Homeserver provider:{" "}
      {provider.termsUrl ? (
        <a
          aria-label={`Terms of Service ${WHOSE}`}
          className={PROVIDER_LINK_CLASS_NAME}
          href={provider.termsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Terms of Service
        </a>
      ) : null}
      {provider.termsUrl && provider.privacyUrl ? " · " : null}
      {provider.privacyUrl ? (
        <a
          aria-label={`Privacy Policy ${WHOSE}`}
          className={PROVIDER_LINK_CLASS_NAME}
          href={provider.privacyUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy Policy
        </a>
      ) : null}
    </p>
  );
}
