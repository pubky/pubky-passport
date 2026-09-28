/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MethodAvailability,
  VerificationMethod,
} from "@/client/logic/homegate/HomegateAvailabilityClient";
import { GoogleIdentityConfigurationProvider } from "./googleIdentityConfiguration";
import { HomegateAvailabilityProvider, useHomegateAvailability } from "./homegateAvailability";
import { PassportCollaboratorsProvider, type PassportCollaborators } from "./passportCollaborators";
import { PassportProviderConfiguration } from "./passportProviderConfiguration";
import type { PassportProvider } from "@/libs/passportProvider";
import { makeInstanceConfig } from "@test-utils/instanceConfig";

type Check = (method: VerificationMethod, signal: AbortSignal) => Promise<MethodAvailability>;

function Probe() {
  const { methods, retry } = useHomegateAvailability();
  return (
    <>
      <output>{JSON.stringify(methods)}</output>
      <button onClick={retry}>Retry</button>
    </>
  );
}

function fakeAvailability(
  check: Check = async (method) => ({
    status: "available",
    ...(method === "lightning" ? { amountSat: 10 } : {}),
  }),
) {
  const probe = vi.fn(check);
  const collaborators: Partial<PassportCollaborators> = {
    createHomegateAvailabilityClient: vi.fn(() => ({ check: probe })),
  };
  // The server enables Google exactly when it ships a client ID, so the fixture does the same.
  function tree(
    googleClientId = "",
    homegateBaseUrl = "https://homegate.example",
    instance: PassportProvider = makeInstanceConfig({
      features: { google: Boolean(googleClientId) },
    }),
    probing = true,
  ) {
    return (
      <PassportCollaboratorsProvider value={collaborators}>
        <PassportProviderConfiguration value={instance}>
          <GoogleIdentityConfigurationProvider
            googleClientId={googleClientId}
            homegateBaseUrl={homegateBaseUrl}
          >
            <HomegateAvailabilityProvider>
              {probing ? <Probe /> : <p>Signed in</p>}
            </HomegateAvailabilityProvider>
          </GoogleIdentityConfigurationProvider>
        </PassportProviderConfiguration>
      </PassportCollaboratorsProvider>
    );
  }
  return { probe, tree, createClient: collaborators.createHomegateAvailabilityClient! };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Homegate availability discovery", () => {
  it("does not contact Homegate until a screen asks for availability", async () => {
    const { probe, tree } = fakeAvailability();
    const view = render(
      tree(
        "",
        "https://homegate.example",
        makeInstanceConfig({ features: { google: false } }),
        false,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(probe).not.toHaveBeenCalled();
    view.rerender(tree());
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
  });

  it("does not probe methods disabled by the provider, even with Google credentials", () => {
    const { probe, tree } = fakeAvailability();
    render(
      tree(
        "configured-client",
        "https://homegate.example",
        makeInstanceConfig({ features: { google: false }, verificationMethods: ["invite"] }),
      ),
    );
    expect(probe).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).not.toContain("checking");
    expect(screen.getByRole("status").textContent).not.toContain("unknown");
  });

  it("does not probe an unconfigured Homegate", () => {
    const { probe, tree } = fakeAvailability();
    render(tree("", ""));
    expect(probe).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).not.toContain("checking");
  });

  it("does not probe Google when the instance runs without it", async () => {
    const { probe, tree, createClient } = fakeAvailability();
    render(tree());
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toContain("checking"));
    expect(createClient).toHaveBeenCalledWith("https://homegate.example");
    expect(probe.mock.calls.map(([method]) => method)).toEqual(["sms", "lightning"]);
    expect(screen.getByRole("status").textContent).toContain('"google":{"status":"unavailable"}');
  });

  it("recovers after a failed probe, and cancels old requests when the configured host changes", async () => {
    const { probe, tree, createClient } = fakeAvailability();
    probe.mockResolvedValue({ status: "unknown" });
    const view = render(tree("client"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("unknown"));
    const previousSignals = probe.mock.calls.map(([, signal]) => signal);
    probe.mockResolvedValue({ status: "available" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toContain("checking"));
    expect(screen.getByRole("status").textContent).not.toContain("unknown");
    expect(previousSignals.every((signal) => signal.aborted)).toBe(true);
    view.rerender(tree("", "https://other.example"));
    await waitFor(() => expect(createClient).toHaveBeenLastCalledWith("https://other.example"));
    expect(screen.getByRole("status").textContent).toContain('"google":{"status":"unavailable"}');
  });
});
