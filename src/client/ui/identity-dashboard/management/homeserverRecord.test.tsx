/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Result } from "better-result";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import type { LocalIdentityHomeserverRepublishResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { PubkyHomeserverResolutionResult } from "@/client/logic/pubky/pubkyIdentityKey";
import { PassportProviderConfiguration } from "@/client/ui/passportProviderConfiguration";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { HomeserverRecord } from "./homeserverRecord";

const MOCKS = vi.hoisted(() => ({ toastInfo: vi.fn() }));

vi.mock("sonner", () => ({ toast: { info: MOCKS.toastInfo } }));

const PUBLIC_KEY = "x8jpihgjy51fdnaingcp8rum1omfzd6p8bhm7usune41grd97dho5cwy4mra";
const PROVIDER_HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";
const OTHER_HOMESERVER = "8um71us3fyw6h8wbcxb5ar3rwusy1a6u49956ikzojg3gcwd1dty";

describe("HomeserverRecord", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("keeps the copy control disabled until the record resolves, then copies it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    let settleLookup!: (value: string) => void;
    renderRecord({
      resolveHomeserver: () =>
        new Promise((resolve) => {
          settleLookup = (pubky) => resolve(Result.ok(pubky));
        }),
    });

    const copy = screen.getByRole("button", { name: "Copy Homeserver" });
    expect(screen.getByText("Looking up…")).toBeInTheDocument();
    expect(copy).toBeDisabled();

    settleLookup(OTHER_HOMESERVER);
    await waitFor(() => expect(copy).toBeEnabled());
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(OTHER_HOMESERVER));
    expect(MOCKS.toastInfo).toHaveBeenCalledWith("Homeserver copied");
    expect(screen.queryByRole("button", { name: "Republish homeserver" })).not.toBeInTheDocument();
  });

  it.each([
    ["an error result", async () => Result.err({ code: "resolution_failed" as const })],
    [
      "a rejected lookup",
      async (): Promise<PubkyHomeserverResolutionResult> => {
        throw new Error("SECRET-HOMESERVER-CANARY");
      },
    ],
  ])("offers a retry, never a republish, after %s", async (_, failedLookup) => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const resolveHomeserver = vi
      .fn<(publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult>>()
      .mockImplementationOnce(failedLookup)
      .mockResolvedValueOnce(Result.ok(OTHER_HOMESERVER));
    const republishHomeserver = vi.fn(async () => Result.ok(PROVIDER_HOMESERVER));
    renderRecord({ republishHomeserver, resolveHomeserver });

    expect(await screen.findByText("Lookup failed")).toBeInTheDocument();
    expect(
      screen.getByText(/could not look up this pubky's homeserver record/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Homeserver" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Republish homeserver" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry lookup" }));
    // The retry button unmounts while looking up; focus lands on the value being looked up.
    expect(screen.getByRole("group", { name: "Homeserver" })).toHaveFocus();
    expect(await screen.findByText(OTHER_HOMESERVER)).toBeInTheDocument();
    expect(resolveHomeserver).toHaveBeenCalledTimes(2);
    expect(resolveHomeserver).toHaveBeenLastCalledWith(PUBLIC_KEY);
    expect(republishHomeserver).not.toHaveBeenCalled();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-HOMESERVER-CANARY");
  });

  it("logs a rejected lookup without its message", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    renderRecord({
      resolveHomeserver: async () => {
        throw new Error("SECRET-HOMESERVER-CANARY");
      },
    });

    await screen.findByText("Lookup failed");
    expect(warning).toHaveBeenCalledWith(
      "identity.management.failed",
      expect.objectContaining({
        operation: "resolve_homeserver",
        diagnosticId: expect.any(String),
        errorName: "Error",
      }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-HOMESERVER-CANARY");
  });

  it("confirms the exact homeserver before republishing a missing record", async () => {
    const republishHomeserver = vi.fn(async () => Result.ok(PROVIDER_HOMESERVER));
    renderRecord({ republishHomeserver, resolveHomeserver: async () => Result.ok(null) });

    expect(await screen.findByText("No record found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Republish homeserver" }));
    const confirmation = screen.getByRole("region", {
      name: "Point this pubky at this homeserver?",
    });
    expect(confirmation).toHaveTextContent(PROVIDER_HOMESERVER);
    expect(confirmation).toHaveTextContent("Only continue if your account was created on");
    // Publishing a wrong homeserver misdirects apps: the caution is a callout, not helper text.
    expect(
      within(confirmation)
        .getByText(/Only continue if/u)
        .closest("[data-tone]"),
    ).toHaveAttribute("data-tone", "warning");
    expect(
      screen.getByRole("heading", { name: "Point this pubky at this homeserver?" }),
    ).toHaveFocus();
    expect(republishHomeserver).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Republish homeserver" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Republish homeserver" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish record" }));
    expect(screen.getByRole("button", { name: "Republishing…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Homeserver record republished."),
    );
    expect(republishHomeserver).toHaveBeenCalledExactlyOnceWith(PUBLIC_KEY, PROVIDER_HOMESERVER);
    expect(screen.getByText(PROVIDER_HOMESERVER)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Homeserver" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Republish homeserver" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Homeserver" })).toHaveFocus();
  });

  it.each([
    ["with", PROVIDER_HOMESERVER],
    ["without", undefined],
  ])(
    "repairs an identity that remembers its homeserver only to that homeserver, %s a provider one",
    async (_, providerHomeserver) => {
      const republishHomeserver = vi.fn(async () => Result.ok(OTHER_HOMESERVER));
      renderRecord({
        providerHomeserver,
        registeredHomeserver: OTHER_HOMESERVER,
        republishHomeserver,
        resolveHomeserver: async () => Result.ok(null),
      });

      fireEvent.click(await screen.findByRole("button", { name: "Republish homeserver" }));
      const confirmation = screen.getByRole("region", {
        name: "Point this pubky back at its homeserver?",
      });
      expect(confirmation).toHaveTextContent(OTHER_HOMESERVER);
      expect(confirmation).not.toHaveTextContent(PROVIDER_HOMESERVER);
      fireEvent.click(screen.getByRole("button", { name: "Publish record" }));

      expect(await screen.findByRole("status")).toHaveTextContent("Homeserver record republished.");
      expect(republishHomeserver).toHaveBeenCalledExactlyOnceWith(PUBLIC_KEY, OTHER_HOMESERVER);
    },
  );

  it.each([
    ["no provider homeserver", { providerHomeserver: undefined }],
    ["no signing key", { republishHomeserver: undefined }],
  ])("does not offer republishing with %s", async (_, props) => {
    renderRecord({ ...props, resolveHomeserver: async () => Result.ok(null) });

    expect(await screen.findByText("No record found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Republish homeserver" })).not.toBeInTheDocument();
  });

  it.each([
    [
      "still_unresolved" as const,
      "The record was published but still does not resolve. Wait a moment and try again.",
    ],
    ["publication_failed" as const, "Could not republish the homeserver record. Please try again."],
    [
      "identity_unavailable" as const,
      "Could not republish the homeserver record. Please try again.",
    ],
    [
      "homeserver_mismatch" as const,
      "Could not republish the homeserver record. Please try again.",
    ],
  ])("reports %s and lets the user try again", async (code, message) => {
    renderRecord({
      republishHomeserver: async () => Result.err({ code }),
      resolveHomeserver: async () => Result.ok(null),
    });

    await republishConfirmed();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByText("No record found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Republish homeserver" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Republish homeserver" })).toHaveFocus();
  });

  it("treats a lookup failure during republishing as unknown, not missing", async () => {
    renderRecord({
      republishHomeserver: async () => Result.err({ code: "resolution_failed" }),
      resolveHomeserver: async () => Result.ok(null),
    });

    await republishConfirmed();

    expect(await screen.findByRole("alert")).toHaveTextContent("nothing was published");
    expect(screen.getByText("Lookup failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry lookup" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Republish homeserver" })).not.toBeInTheDocument();
  });

  it("contains a rejected republish without exposing its message", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    renderRecord({
      republishHomeserver: async () => {
        throw new Error("SECRET-REPUBLISH-CANARY");
      },
      resolveHomeserver: async () => Result.ok(null),
    });

    await republishConfirmed();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not republish the homeserver record. Please try again.",
    );
    expect(warning).toHaveBeenCalledWith(
      "identity.management.failed",
      expect.objectContaining({ operation: "republish_homeserver" }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-REPUBLISH-CANARY");
  });

  it("shows provider storage only for an account on the provider homeserver", async () => {
    const provider = makeInstanceConfig({
      storageDescription: "1 GB of storage included.",
      upgradeUrl: "https://acme.example/storage",
      termsUrl: "https://acme.example/terms",
    });
    renderRecord({ resolveHomeserver: async () => Result.ok(PROVIDER_HOMESERVER) }, (children) => (
      <PassportProviderConfiguration value={provider}>{children}</PassportProviderConfiguration>
    ));

    expect(await screen.findByText("1 GB of storage included.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage storage" })).toHaveAttribute(
      "href",
      "https://acme.example/storage",
    );
    expect(screen.getByRole("link", { name: "Terms of service" })).toBeInTheDocument();

    cleanup();
    renderRecord({ resolveHomeserver: async () => Result.ok(OTHER_HOMESERVER) }, (children) => (
      <PassportProviderConfiguration value={provider}>{children}</PassportProviderConfiguration>
    ));
    expect(await screen.findByText(OTHER_HOMESERVER)).toBeInTheDocument();
    expect(screen.queryByText("1 GB of storage included.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

async function republishConfirmed() {
  fireEvent.click(await screen.findByRole("button", { name: "Republish homeserver" }));
  fireEvent.click(screen.getByRole("button", { name: "Publish record" }));
}

function renderRecord(
  options: {
    providerHomeserver?: string | undefined;
    registeredHomeserver?: string | undefined;
    republishHomeserver?:
      | ((
          publicKeyZ32: string,
          homeserverPubky: string,
        ) => Promise<LocalIdentityHomeserverRepublishResult>)
      | undefined;
    resolveHomeserver: (publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult>;
  },
  wrap: (children: ReactElement) => ReactElement = (children) => (
    <PassportProviderConfiguration value={makeInstanceConfig()}>
      {children}
    </PassportProviderConfiguration>
  ),
) {
  // An explicitly undefined option removes that capability instead of taking the default.
  const providerHomeserver =
    "providerHomeserver" in options ? options.providerHomeserver : PROVIDER_HOMESERVER;
  const republishHomeserver =
    "republishHomeserver" in options
      ? options.republishHomeserver
      : async () => Result.ok(PROVIDER_HOMESERVER);
  return render(
    wrap(
      <HomeserverRecord
        providerHomeserver={providerHomeserver}
        publicKeyZ32={PUBLIC_KEY}
        registeredHomeserver={options.registeredHomeserver}
        resolveHomeserver={options.resolveHomeserver}
        {...(republishHomeserver ? { republishHomeserver } : {})}
      />,
    ),
  );
}
