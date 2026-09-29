/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { MethodAvailability } from "@/client/logic/homegate/HomegateAvailabilityClient";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { GoogleIdentityConfigurationProvider } from "@/client/ui/googleIdentityConfiguration";
import { HomegateAvailabilityContext } from "@/client/ui/homegateAvailability";
import { PassportProviderConfiguration } from "@/client/ui/passportProviderConfiguration";
import { AddIdentity } from "./addIdentity";

afterEach(cleanup);

function request(review: Partial<AuthorizationRequestReview> = {}): AuthorizationRequestReview {
  return {
    authenticationMethod: "cookie",
    capabilities: [{ path: "/pub/example.app/", read: true, write: true, scope: "specific" }],
    ...review,
  };
}

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
  expect(screen.getByRole("button", { name: "Open in Pubky Ring" })).toBeEnabled();
  // Without Google only the own-key card remains, so the page keeps the narrow column.
  expect(screen.getByRole("main")).toHaveClass("max-w-[588px]");
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
        "Creating an account with Google isn’t available in your country. You can still restore an existing one.",
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

  it("recommends Create account first, then Google, and keeps Ring out of the cards", () => {
    renderAddIdentity(addIdentity({ onUseRing: vi.fn() }));

    const cards = screen.getAllByRole("region");
    expect(cards.map((card) => card.getAttribute("aria-labelledby"))).toEqual([
      "add-account-heading",
      "add-google-heading",
    ]);
    const create = screen.getByRole("button", { name: "Create account" });
    expect(cards[0]).toContainElement(create);
    // The one brand button is the recommendation; every other entry stays secondary.
    expect(create).toHaveClass("bg-brand/16");
    const importBackup = screen.getByRole("button", { name: "Import backup" });
    expect(cards[0]).toContainElement(importBackup);
    expect(importBackup).not.toHaveClass("bg-brand/16");
    expect(cards[1]).toContainElement(screen.getByRole("button", { name: "Continue with Google" }));
    const ring = screen.getByRole("button", { name: "Open in Pubky Ring" });
    for (const card of cards) expect(card).not.toContainElement(ring);
    expect(ring).not.toHaveClass("bg-brand/16");
    expect(ring.closest("p")).toHaveTextContent(/^Already use Pubky Ring\?/u);
    expect(screen.getByRole("main")).toHaveClass("max-w-[1280px]");
    // Create account precedes Google in tab order as well as on screen.
    expect(
      create.compareDocumentPosition(screen.getByRole("button", { name: "Continue with Google" })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it.each([
    [
      { request: request({ requesterName: "Example App", callbackHost: "example.app" }) },
      "Sign in to Example App",
    ],
    [{ request: request({ callbackHost: "example.app" }) }, "Sign in to example.app"],
    [{}, "Get your pubky."],
    [{ onBack: vi.fn() }, "Add an account."],
  ])("names the task in the heading with %o", (props, heading) => {
    renderAddIdentity(addIdentity(props));

    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  // The app picks its own label, so the heading never shows it alone, as on the review.
  it.each([
    [
      "a label that differs from its website",
      { requesterName: "Your Bank Secure Login", callbackHost: "login.attacker.example" },
      "Website: login.attacker.example",
    ],
    [
      "a label and no website",
      { requesterName: "Your Bank Secure Login" },
      "This request doesn't name a website. Only continue if you just started signing in on another device.",
    ],
  ])("backs the requester's name when a request has %s", (_case, review, backing) => {
    renderAddIdentity(addIdentity({ request: request(review) }));

    expect(
      screen.getByRole("heading", { level: 1, name: "Sign in to Your Bank Secure Login" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.tagName === "P" && element.textContent === backing),
    ).toBeVisible();
  });

  it.each([true, false])(
    "takes the authorization layout from the shell's request, not from Ring, forAuthorization=%s",
    async (forAuthorization) => {
      const pending = forAuthorization ? request() : undefined;
      renderAddIdentity(addIdentity({ request: pending, onUseRing: vi.fn() }));

      await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

      const actions = (await screen.findByRole("button", { name: "Cancel" })).parentElement;
      expect(actions?.classList.contains("md:pointer-fine:grid-cols-2")).toBe(!forAuthorization);
    },
  );

  it("keeps the Google check's retry with the cards, above the Ring line", () => {
    renderAddIdentity(addIdentity({ onConnectRing: vi.fn() }), "unknown");

    const retry = screen.getByRole("button", { name: "Check again" });
    const ring = screen.getByRole("button", { name: "Sign in with Pubky Ring" });
    expect(retry.compareDocumentPosition(ring)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByRole("region", { name: "Google account" }).compareDocumentPosition(retry),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("Pubky Ring on the add screen", () => {
  it("signs in with an existing Ring identity when no request is pending", async () => {
    const onConnectRing = vi.fn();
    renderAddIdentity(addIdentity({ onConnectRing }));

    expect(screen.getByText("Already use Pubky Ring?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in Pubky Ring" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign in with Pubky Ring" }));
    expect(onConnectRing).toHaveBeenCalledOnce();
  });

  it("opens a pending request in Ring, named as on the review, instead of connecting", () => {
    renderAddIdentity(addIdentity({ onUseRing: vi.fn(), onConnectRing: vi.fn() }));

    expect(screen.getByRole("button", { name: "Open in Pubky Ring" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Sign in with Pubky Ring" }),
    ).not.toBeInTheDocument();
  });
});
