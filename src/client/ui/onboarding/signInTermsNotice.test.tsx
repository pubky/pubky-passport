/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fakeAppleIdentityController,
  TEST_APPLE_CONFIGURATION,
} from "@test-utils/fakeAppleIdentityController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import { AppleIdentityConfigurationProvider } from "@/client/ui/appleIdentityConfiguration";
import { IdentityEstablishmentFlow } from "./identityEstablishmentFlow";
import { ProviderChoice } from "./providerChoice";

const CONSENT =
  "By continuing, you agree to the Pubky Passport Terms of Service and Privacy Policy, and confirm you are over 18.";
const BUILT_BY =
  "Pubky Passport is powered by the Pubky protocol. Built by Synonym Software, S.A. DE C.V.";

/** The notice's two paragraphs and links, checked exactly. */
function expectTermsNotice(scope: HTMLElement) {
  const consent = within(scope).getByText(
    (_, node) => node?.tagName === "P" && node.textContent === CONSENT,
  );
  const notice = consent.parentElement!;
  expect([...notice.querySelectorAll("p")].map((p) => p.textContent)).toEqual([CONSENT, BUILT_BY]);
  const links = within(notice).getAllByRole("link");
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Terms of Service", "/terms-of-service"],
    ["Privacy Policy", "/privacy-policy"],
  ]);
  for (const link of links) {
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveClass("underline");
  }
  // "Pubky protocol" stays plain text, and continuing is the consent: no checkbox.
  expect(within(notice).queryByRole("link", { name: /Pubky protocol/u })).toBeNull();
  expect(within(scope).queryByRole("checkbox")).toBeNull();
  expect(notice).toHaveClass("text-muted-foreground");
  return notice;
}

/** True when `first` comes before `second` in document order. */
function precedes(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function renderFlow({
  apple,
  forAuthorization = false,
  onBack,
}: {
  apple: typeof TEST_APPLE_CONFIGURATION | null;
  forAuthorization?: boolean;
  onBack?: () => void;
}) {
  const fake = fakeAppleIdentityController();
  return render(
    withPassportTestProviders(
      <AppleIdentityConfigurationProvider apple={apple}>
        <IdentityEstablishmentFlow
          forAuthorization={forAuthorization}
          onBack={onBack}
          onComplete={vi.fn()}
        />
      </AppleIdentityConfigurationProvider>,
      {
        createAppleIdentityController: () => fake.controller,
        createGoogleIdentityController: () =>
          mockGoogleIdentityController({
            establishIdentity: vi.fn(() => new Promise<never>(() => undefined)),
          }),
      },
    ),
  );
}

describe("Terms and Privacy notice", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([true, false])(
    "sits directly under the provider buttons, with exact copy and new-tab links (Apple=%s)",
    (appleEnabled) => {
      const { container } = render(
        <ProviderChoice
          apple={appleEnabled ? { ready: true, onContinue: vi.fn() } : null}
          onContinueWithGoogle={vi.fn()}
        />,
      );
      const notice = expectTermsNotice(container);
      const buttons = screen.getAllByRole("button", { name: /^Continue with/u });
      expect(buttons.map((button) => button.textContent)).toEqual(
        appleEnabled ? ["Continue with Google", "Continue with Apple"] : ["Continue with Google"],
      );
      // Under the last button, and the provider group (if any) holds only the buttons.
      expect(precedes(buttons.at(-1)!, notice)).toBe(true);
      expect(notice.previousElementSibling).toContainElement(buttons.at(-1)!);
      // The Synonym badge follows the notice directly and ends the choice.
      const badge = screen.getByRole("img", { name: "Synonym, a Tether company" });
      expect(notice.nextElementSibling).toBe(badge);
      expect(badge.nextElementSibling).toBeNull();
      expect(screen.getAllByText(/By continuing/u)).toHaveLength(1);
      if (appleEnabled) {
        const choice = screen.getByRole("group", { name: "Choose an account to sign in with" });
        expect(choice).not.toContainElement(notice);
      }
    },
  );

  it.each([true, false])(
    "renders on the start page and Add identity, once, above Back (Apple=%s)",
    async (appleEnabled) => {
      const { container } = renderFlow({
        apple: appleEnabled ? TEST_APPLE_CONFIGURATION : null,
        onBack: vi.fn(),
      });
      await screen.findByRole("button", { name: "Continue with Google" });
      const notice = expectTermsNotice(container);
      expect(screen.getAllByText(/By continuing/u)).toHaveLength(1);
      expect(precedes(notice, screen.getByRole("button", { name: "Back" }))).toBe(true);
      expect(screen.queryAllByRole("button", { name: "Continue with Apple" }).length > 0).toBe(
        appleEnabled,
      );
    },
  );

  it("renders in the authorization sign-in (/authorize, Use other identity) with Apple on", async () => {
    const { container } = renderFlow({
      apple: TEST_APPLE_CONFIGURATION,
      forAuthorization: true,
      onBack: vi.fn(),
    });
    await screen.findByRole("button", { name: "Continue with Apple" });
    const notice = expectTermsNotice(container);
    expect(precedes(screen.getByRole("button", { name: "Continue with Apple" }), notice)).toBe(
      true,
    );
    expect(precedes(notice, screen.getByRole("button", { name: "Back" }))).toBe(true);
  });
});
