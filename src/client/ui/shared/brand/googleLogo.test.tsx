/** @vitest-environment jsdom */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { AuthorizationReview } from "@/client/ui/authorization/review/authorizationReview";
import { IdentitySwitcher } from "@/client/ui/identity-catalog/selection/identitySwitcher";
import { IdentityOverview } from "@/client/ui/identity-dashboard/identityOverview";
import { ContinueWithGoogle } from "@/client/ui/onboarding/google/continueWithGoogle";
import { ProviderAccountCard } from "@/client/ui/shared/providerAccountCard";

/** The small "G" badge on a Google identity's avatar or account line. */
const GOOGLE_BADGE_VIEWBOX = "0 0 16 16";

const GOOGLE_IDENTITY: LocalIdentityMetadata = {
  publicIdentity: { publicKeyZ32: "googleidentity1234" },
  googleAccount: {
    googleSubject: "google-1",
    email: "satoshi@gmail.com",
    name: "Satoshi Nakamoto",
    pictureUrl: null,
  },
};

const APPLE_IDENTITY: LocalIdentityMetadata = {
  publicIdentity: { publicKeyZ32: "appleidentity1234" },
  appleAccount: { appleSubject: "apple-1", email: "jane@icloud.com", name: "Jane Appleseed" },
};

/** One Google "G" badge, 16px, and no "Google Account" text. */
function expectGoogleBadge(container: HTMLElement) {
  const badges = container.querySelectorAll(`svg[viewBox="${GOOGLE_BADGE_VIEWBOX}"]`);
  expect(badges).toHaveLength(1);
  expect(badges[0]).toHaveAttribute("aria-hidden", "true");
  expect(badges[0]).toHaveAttribute("width", "16");
  expect(badges[0]).toHaveAttribute("height", "16");
  expect(badges[0]?.querySelector("path[fill='#4285F4' i]")).not.toBeNull();
  expect(screen.queryByText(/Google Account/u)).toBeNull();
}

/** No Google "G" of any kind. */
function expectNoGoogleLogo(container: HTMLElement) {
  expect(container.querySelector("svg path[fill='#4285F4' i]")).toBeNull();
}

function renderReview(identity: LocalIdentityMetadata) {
  return render(
    <AuthorizationReview
      identity={identity}
      onAuthorize={vi.fn()}
      onCancel={vi.fn()}
      onManage={vi.fn()}
      onSwitch={vi.fn()}
      phase="review"
      review={{ authenticationMethod: "grant", callbackHost: "chat.example", capabilities: [] }}
    />,
  );
}

function renderSwitcher(identity: LocalIdentityMetadata) {
  return render(
    <IdentitySwitcher
      activePublicKeyZ32={identity.publicIdentity.publicKeyZ32}
      identities={[identity]}
      onAddIdentity={vi.fn()}
      onBack={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
}

describe("Google logo", () => {
  afterEach(cleanup);

  it("draws Google's standard-color G inside Continue with Google", () => {
    render(<ContinueWithGoogle onContinue={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Continue with Google" });
    const logo = button.querySelector("img");
    expect(logo).toHaveAttribute("aria-hidden", "true");
    expect(logo).toHaveAttribute("src", "/brand/google-sign-in-g.png");
  });

  it("marks a Google account card with the G badge", () => {
    const { container } = render(
      <ProviderAccountCard
        account={{ provider: "google", googleAccount: GOOGLE_IDENTITY.googleAccount! }}
      />,
    );

    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    expectGoogleBadge(container);
    expect(container.querySelector(`svg[viewBox="${GOOGLE_BADGE_VIEWBOX}"]`)).toHaveClass("size-4");
  });

  it("puts the G badge before the email on the identity overview", () => {
    const { container } = render(
      <IdentityOverview identity={GOOGLE_IDENTITY} onManage={vi.fn()} onSwitch={vi.fn()} />,
    );

    const email = screen.getByText("satoshi@gmail.com");
    expectGoogleBadge(container);
    expect(email.firstElementChild?.getAttribute("viewBox")).toBe(GOOGLE_BADGE_VIEWBOX);
  });

  it("badges the Google identity's avatar in the identity switcher", () => {
    const { container } = renderSwitcher(GOOGLE_IDENTITY);

    const row = screen.getByRole("button", { name: /Satoshi Nakamoto/u });
    expect(row).toHaveAccessibleName("Satoshi Nakamotosatoshi@gmail.com");
    expectGoogleBadge(container);
    expect(row.querySelector(`svg[viewBox="${GOOGLE_BADGE_VIEWBOX}"]`)?.parentElement).toHaveClass(
      "absolute",
      "size-4",
    );
  });

  it("badges the Google identity's avatar on the authorization review", () => {
    const { container } = renderReview(GOOGLE_IDENTITY);

    expectGoogleBadge(container);
    expect(
      container.querySelector(`svg[viewBox="${GOOGLE_BADGE_VIEWBOX}"]`)?.parentElement,
    ).toHaveClass("absolute", "size-4");
  });

  it.each([
    ["identity switcher", () => renderSwitcher(APPLE_IDENTITY)],
    ["authorization review", () => renderReview(APPLE_IDENTITY)],
    [
      "identity overview",
      () =>
        render(
          <IdentityOverview identity={APPLE_IDENTITY} onManage={vi.fn()} onSwitch={vi.fn()} />,
        ),
    ],
  ])("shows no Google G on an Apple identity on the %s", (_screen, renderScreen) => {
    const { container } = renderScreen();

    expect(screen.getByText("Jane Appleseed", { exact: true })).toBeVisible();
    expectNoGoogleLogo(container);
  });

  it("keeps Google Identity Services' G for the Continue with Google button only", () => {
    const root = join(process.cwd(), "src");
    const users = sourceFiles(root)
      .filter((path) => !path.endsWith(".test.tsx") && !path.endsWith(".test.ts"))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return source.includes("GoogleButtonLogo") || source.includes("M46.98 24.55");
      })
      .map((path) => relative(root, path))
      .sort();

    expect(users).toEqual([
      "client/ui/onboarding/google/continueWithGoogle.tsx",
      "client/ui/shared/brand/googleButtonLogo.tsx",
    ]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/u.test(entry.name) ? [path] : [];
  });
}
