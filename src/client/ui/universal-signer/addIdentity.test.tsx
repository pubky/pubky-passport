/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MethodAvailability } from "@/client/logic/homegate/HomegateAvailabilityClient";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { GoogleIdentityConfigurationProvider } from "@/client/ui/googleIdentityConfiguration";
import { HomegateAvailabilityContext } from "@/client/ui/homegateAvailability";
import { PassportProviderConfiguration } from "@/client/ui/passportProviderConfiguration";
import { AddIdentity } from "./addIdentity";

afterEach(cleanup);

function renderAddIdentity(
  view: ReactNode,
  google: MethodAvailability["status"] = "available",
  establishIdentity = vi.fn(() => new Promise<never>(() => undefined)),
) {
  render(
    withPassportTestProviders(
      <HomegateAvailabilityContext
        value={{
          methods: {
            google: { status: google },
            sms: { status: "available" },
            lightning: { status: "available" },
          },
          retry: vi.fn(),
        }}
      >
        {view}
      </HomegateAvailabilityContext>,
      { createGoogleIdentityController: () => mockGoogleIdentityController({ establishIdentity }) },
    ),
  );
  return establishIdentity;
}

function addIdentity(props: Partial<Parameters<typeof AddIdentity>[0]> = {}) {
  return (
    <AddIdentity onComplete={vi.fn()} onCreateAccount={vi.fn()} onImport={vi.fn()} {...props} />
  );
}

it("renders an invite-only instance without Google or Homegate credentials", () => {
  render(
    withPassportTestProviders(
      <PassportProviderConfiguration
        value={makeInstanceConfig({ features: { google: false }, verificationMethods: ["invite"] })}
      >
        <GoogleIdentityConfigurationProvider googleClientId="" homegateBaseUrl="">
          <AddIdentity
            onComplete={vi.fn()}
            onImport={vi.fn()}
            onCreateAccount={vi.fn()}
            onUseRing={vi.fn()}
          />
        </GoogleIdentityConfigurationProvider>
      </PassportProviderConfiguration>,
    ),
  );
  expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Import backup" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Use Pubky Ring" })).toBeEnabled();
});

describe("AddIdentity", () => {
  it.each(["available", "unavailable", "unknown", "checking", "blocked"] as const)(
    "starts Google restore while the Homegate probe reports %s",
    async (status) => {
      const establishIdentity = renderAddIdentity(addIdentity(), status);

      const google = screen.getByRole("button", { name: "Continue with Google" });
      expect(google).toBeEnabled();
      await userEvent.setup().click(google);

      expect(establishIdentity).toHaveBeenCalledOnce();
      expect(
        await screen.findByRole("heading", { name: "Requesting Google Drive access." }),
      ).toBeInTheDocument();
    },
  );

  it("explains a regional block as limited to new Google identities", () => {
    renderAddIdentity(addIdentity(), "blocked");

    expect(
      screen.getByText(
        "New Google identities are not available in your country. You can still restore an existing one.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  // The server turns the feature off when the provider disables Google or no client ID is set.
  it("hides Google when the instance runs without it", () => {
    renderAddIdentity(
      <PassportProviderConfiguration value={makeInstanceConfig({ features: { google: false } })}>
        {addIdentity()}
      </PassportProviderConfiguration>,
    );

    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import backup" })).toBeEnabled();
  });

  it.each([true, false])(
    "takes the authorization layout from the shell, not from Ring, forAuthorization=%s",
    async (forAuthorization) => {
      renderAddIdentity(addIdentity({ forAuthorization, onUseRing: vi.fn() }));

      await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

      const waiting = await screen.findByRole("button", { name: "Waiting for Google..." });
      expect(waiting.classList.contains("md:w-[220px]")).toBe(!forAuthorization);
    },
  );
});

describe("Pubky Ring on the add screen", () => {
  it("connects an existing Ring identity when no request is pending", async () => {
    const onConnectRing = vi.fn();
    renderAddIdentity(addIdentity({ onConnectRing }));

    expect(screen.getByText(/connect Pubky Ring/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use Pubky Ring" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Connect Pubky Ring" }));
    expect(onConnectRing).toHaveBeenCalledOnce();
  });

  it("hands a pending request to Ring instead of connecting it", () => {
    renderAddIdentity(addIdentity({ onUseRing: vi.fn(), onConnectRing: vi.fn() }));

    expect(screen.getByRole("button", { name: "Use Pubky Ring" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Connect Pubky Ring" })).not.toBeInTheDocument();
  });
});
