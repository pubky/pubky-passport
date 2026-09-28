/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { makeInstanceConfig } from "@test-utils/instanceConfig";
import {
  PassportProviderConfiguration,
  ProviderTerms,
  usePassportProvider,
} from "./passportProviderConfiguration";

function ProviderProbe() {
  const provider = usePassportProvider();
  return (
    <output>
      {provider.verificationMethods.join(",")}|{String(provider.features.google)}|
      {provider.homeserver ?? "none"}
    </output>
  );
}

describe("PassportProviderConfiguration", () => {
  afterEach(cleanup);

  it("makes the server-rendered instance configuration available to client consumers", () => {
    render(
      <PassportProviderConfiguration
        value={makeInstanceConfig({
          verificationMethods: ["invite"],
          features: { google: false },
          homeserver: null,
        })}
      >
        <ProviderProbe />
      </PassportProviderConfiguration>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("invite|false|none");
  });

  it("fails instead of assuming every feature when rendered outside the layout", () => {
    expect(() => render(<ProviderProbe />)).toThrow(
      "Passport provider configuration is unavailable.",
    );
  });

  it("links the provider's terms and privacy policy", () => {
    render(
      <PassportProviderConfiguration
        value={makeInstanceConfig({
          termsUrl: "https://acme.example/terms",
          privacyUrl: "https://acme.example/privacy",
        })}
      >
        <ProviderTerms />
      </PassportProviderConfiguration>,
    );

    expect(screen.getByRole("link", { name: "Terms of service" })).toHaveAttribute(
      "href",
      "https://acme.example/terms",
    );
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "https://acme.example/privacy",
    );
    expect(screen.getByText(/^Homeserver provider:/u)).toBeInTheDocument();
  });
});
