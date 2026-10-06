import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PassportProviderConfiguration } from "@/client/ui/passportProviderConfiguration";
import { PassportHeaderActionSlot } from "@/client/ui/shared/passportHeaderAction";
import { TestnetBadge } from "@/client/ui/shared/testnetBadge";
import { LOGGER } from "@/libs/logger/logger";
import { stubPassportEnvironment } from "@test-utils/passportEnvironment";
import RootLayout from "./layout";

const MOCKS = vi.hoisted(() => ({ connection: vi.fn() }));

vi.mock("@fontsource-variable/inter-tight", () => ({}));
vi.mock("./globals.css", () => ({}));
vi.mock("next/server", () => ({ connection: MOCKS.connection }));

describe("RootLayout bootstrap", () => {
  beforeEach(() => stubPassportEnvironment());

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects invalid bootstrap configuration without exposing its values", async () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    vi.stubEnv("GOOGLE_CLIENT_ID", "SECRET-GOOGLE-CLIENT-ID");
    vi.stubEnv("HOMEGATE_URL", "SECRET-HOMEGATE-URL");

    await expect(RootLayout({ children: null })).rejects.toThrow(
      "Application configuration unavailable.",
    );
    expect(error).toHaveBeenCalledWith(
      "layout.bootstrap.failed",
      expect.objectContaining({
        layer: "layout",
        operation: "bootstrap",
        stage: "configuration",
        code: "invalid_configuration",
        diagnosticId: expect.any(String),
        errorName: expect.any(String),
      }),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-GOOGLE-CLIENT-ID");
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-HOMEGATE-URL");
  });

  it("rejects invalid provider configuration", async () => {
    vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    vi.stubEnv("PASSPORT_PROVIDER_CONFIG_JSON", JSON.stringify({ googleEnabled: "yes" }));

    await expect(RootLayout({ children: null })).rejects.toThrow(
      "Application configuration unavailable.",
    );
  });

  it("renders the resolved instance configuration once, with the header action slot", async () => {
    stubPassportEnvironment({
      PASSPORT_PROVIDER_CONFIG_JSON: JSON.stringify({
        googleEnabled: false,
        verificationMethods: ["invite"],
      }),
      HOMEGATE_URL: undefined,
    });
    const layout = await RootLayout({ children: null });

    expect(findElements(layout, PassportProviderConfiguration)).toEqual([
      expect.objectContaining({
        props: expect.objectContaining({
          value: {
            verificationMethods: ["invite"],
            features: { google: false },
            homeserver: null,
            httpRelay: "https://httprelay.pubky.app/inbox",
            network: { network: "mainnet" },
          },
        }),
      }),
    ]);
    expect(findElements(layout, PassportHeaderActionSlot)).toHaveLength(1);
    // Passport names no provider; the header carries only the logo and the action slot.
    expect(textOf(layout)).not.toContain("Hosted by");
    // Mainnet: the pre-hydration code reads the network, and no badge shows.
    expect(findElements(layout, "meta")).toEqual([
      expect.objectContaining({ props: { content: "mainnet", name: "pubky-network" } }),
    ]);
    expect(findElements(layout, TestnetBadge)).toEqual([]);
  });

  it("marks a testnet instance in its meta and with a visible badge in the header", async () => {
    stubPassportEnvironment({
      PUBKY_NETWORK: "testnet",
      PUBKY_TESTNET_PKARR_RELAYS: "https://gateway.example/_pubky/pkarr",
      PUBKY_TESTNET_HTTP_RELAY: "https://gateway.example/_pubky/relay/inbox",
    });
    const layout = await RootLayout({ children: null });

    expect(findElements(layout, "meta")).toEqual([
      expect.objectContaining({ props: { content: "testnet", name: "pubky-network" } }),
    ]);
    expect(findElements(layout, TestnetBadge)).toEqual([
      expect.objectContaining({ props: { network: "testnet" } }),
    ]);
  });
});

function findElements(node: ReactNode, type: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => findElements(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type ? [node] : []), ...findElements(node.props.children, type)];
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child: ReactNode) => textOf(child)).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : "";
}
