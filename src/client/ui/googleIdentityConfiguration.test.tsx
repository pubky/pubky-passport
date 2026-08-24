/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  GoogleIdentityConfigurationProvider,
  useGoogleIdentityConfiguration,
} from "./googleIdentityConfiguration";

function ConfigurationProbe() {
  const configuration = useGoogleIdentityConfiguration();
  return <output>{configuration.googleClientId}|{configuration.homegateBaseUrl}</output>;
}

describe("GoogleIdentityConfigurationProvider", () => {
  it("makes browser bootstrap configuration available to client consumers", () => {
    render(
      <GoogleIdentityConfigurationProvider
        googleClientId="google-client-id"
        homegateBaseUrl="https://homegate.example/"
      >
        <ConfigurationProbe />
      </GoogleIdentityConfigurationProvider>,
    );

    expect(screen.getByText("google-client-id|https://homegate.example/")).toBeInTheDocument();
  });

  it("fails when a consumer is rendered outside the bootstrap boundary", () => {
    expect(() => render(<ConfigurationProbe />)).toThrow(
      "Google identity configuration is unavailable.",
    );
  });
});
