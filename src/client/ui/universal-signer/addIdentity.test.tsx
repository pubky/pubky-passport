/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
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

it("says an invite is needed where neither SMS nor Lightning is offered", () => {
  render(
    withPassportTestProviders(
      <HomegateAvailabilityContext
        value={{
          methods: {
            google: { status: "unavailable" },
            sms: { status: "unavailable" },
            lightning: { status: "unavailable" },
          },
          retry: vi.fn(),
        }}
      >
        {addIdentity()}
      </HomegateAvailabilityContext>,
    ),
  );
  expect(screen.getByText(/Create an account with an invite code/u)).toBeInTheDocument();
});

it("does not ask for an invite while other methods may still be offered", () => {
  renderAddIdentity(addIdentity());
  expect(screen.queryByText(/with an invite code/u)).not.toBeInTheDocument();
});

describe("AddIdentity", () => {
  it.each(["available", "unavailable", "unknown", "checking", "blocked"] as const)(
    "starts Google restore while the Homegate probe reports %s",
    async (status) => {
      const establishIdentity = renderAddIdentity(addIdentity(), status);

      const google = screen.getByRole("button", {
        name: status === "blocked" ? "Restore with Google" : "Continue with Google",
      });
      expect(google).toBeEnabled();
      await userEvent.setup().click(google);

      expect(establishIdentity).toHaveBeenCalledOnce();
      expect(
        await screen.findByRole("heading", { name: "Requesting Google Drive access." }),
      ).toBeInTheDocument();
    },
  );

  it("explains a regional block inside the Google card, as limited to new sign-ups", () => {
    renderAddIdentity(addIdentity(), "blocked");

    const card = screen.getByRole("region", { name: "Google account" });
    const note = within(card).getByRole("status");
    expect(note).toHaveTextContent(
      "New Google sign-ups aren’t available in your country. You can still restore a pubky you created with Google.",
    );
    expect(note).toHaveAttribute("data-tone", "warning");
    // The card no longer offers what the note rules out.
    expect(card).toHaveTextContent("Restore an account you created with Google.");
    expect(card).not.toHaveTextContent("Create or restore");
    expect(within(card).getByRole("button", { name: "Restore with Google" })).toBeEnabled();
    expect(within(note).getByRole("button", { name: "Check again" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Check again" })).toHaveLength(1);
  });

  it("says in the Google card when the sign-up check failed, not verification methods", () => {
    renderAddIdentity(addIdentity(), "unknown");

    const card = screen.getByRole("region", { name: "Google account" });
    expect(within(card).getByRole("status")).toHaveTextContent(
      "Couldn’t check whether new Google sign-ups work where you are. You can still try, and restoring a pubky you created with Google always works.",
    );
    expect(screen.queryByText(/verification methods|invite code/u)).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Check again" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  it.each(["checking", "available"] as const)(
    "shows no availability note while the first check is %s",
    (status) => {
      renderAddIdentity(addIdentity(), status);

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    },
  );

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
    expect(cards).toEqual([
      screen.getByRole("region", { name: "Hold your own key" }),
      screen.getByRole("region", { name: "Google account" }),
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
    // A quiet text link, not a pill that competes with the cards' buttons.
    expect(ring).toHaveClass("underline");
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

  it("keeps the Google check's retry inside the Google card, above the Ring line", () => {
    renderAddIdentity(addIdentity({ onConnectRing: vi.fn() }), "unknown");

    const retry = screen.getByRole("button", { name: "Check again" });
    const ring = screen.getByRole("button", { name: "Sign in with Pubky Ring" });
    expect(retry.compareDocumentPosition(ring)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole("region", { name: "Google account" })).toContainElement(retry);
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
