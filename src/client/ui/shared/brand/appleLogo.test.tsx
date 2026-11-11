/** @vitest-environment jsdom */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { AuthorizationReview } from "@/client/ui/authorization/review/authorizationReview";
import { IdentitySwitcher } from "@/client/ui/identity-catalog/selection/identitySwitcher";
import { IdentityOverview } from "@/client/ui/identity-dashboard/identityOverview";
import { ContinueWithApple } from "@/client/ui/onboarding/apple/continueWithApple";
import { ProviderAccountCard } from "@/client/ui/shared/providerAccountCard";

const LOGO_SRC = "/brand/sign-in-with-apple/logo-left-aligned-black-small.svg";
/** SHA-256 of Apple's "Logo - SIWA - Left-aligned - Black - Small.svg", as downloaded. */
const APPLE_FILE_SHA256 = "c94282c5541e24cab648a26d38c2fb072a3e767b8ffe13c5407feda6090a76ce";

/** The Apple logo as a character in Apple's fonts (U+F8FF). */
const APPLE_CHARACTER = "\uF8FF";

const APPLE_IDENTITY: LocalIdentityMetadata = {
  publicIdentity: { publicKeyZ32: "appleidentity1234" },
  appleAccount: {
    appleSubject: "001234.abcdef.1234",
    email: "jane@privaterelay.appleid.com",
    name: "Jane Appleseed",
  },
};

/** The glyph path in Apple's logo file, which the badge draws unchanged. */
const APPLE_GLYPH_PATH = /<path d="([^"]+)"/u.exec(
  readFileSync(join(process.cwd(), "public", LOGO_SRC), "utf8"),
)?.[1];

/** The small Apple badge, the counterpart of the Google "G" badge on Google identities. */
const APPLE_BADGE_VIEWBOX = "4.558 13.4 15 15";
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

/**
 * One Apple badge, drawn like the G badge (16px, hidden from assistive technology), with Apple's
 * glyph unchanged in solid white, and no "Apple Account" text label. Returns the badge.
 */
function expectAppleBadge(container: HTMLElement): SVGElement {
  const badges = container.querySelectorAll<SVGElement>(`svg[viewBox="${APPLE_BADGE_VIEWBOX}"]`);
  expect(badges).toHaveLength(1);
  const badge = badges[0]!;
  expect(badge).toHaveAttribute("aria-hidden", "true");
  expect(badge).toHaveAttribute("width", "16");
  expect(badge).toHaveAttribute("height", "16");
  const paths = badge.querySelectorAll("path");
  expect(paths).toHaveLength(1);
  expect(paths[0]).toHaveAttribute("d", APPLE_GLYPH_PATH);
  expect(paths[0]).toHaveAttribute("fill", "#FFFFFF");
  expect(container.querySelector(`img[src*="sign-in-with-apple"]`)).toBeNull();
  expect(container.textContent).not.toContain(APPLE_CHARACTER);
  return badge;
}

/** The badge sits where the G badge sits: on the avatar's bottom-right corner, 16px. */
function expectAvatarBadge(badge: Element) {
  expect(badge.parentElement).toHaveClass("absolute", "bottom-px", "right-px", "size-4");
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

describe("Apple logo", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("ships Apple's logo file unchanged", () => {
    const file = readFileSync(join(process.cwd(), "public", LOGO_SRC));
    expect(createHash("sha256").update(file).digest("hex")).toBe(APPLE_FILE_SHA256);
  });

  it("has no other Sign in with Apple artwork in public files", () => {
    const publicRoot = join(process.cwd(), "public");
    const withAppleGlyph = publicFiles(publicRoot)
      .filter((path) => readFileSync(path, "latin1").includes("M12.2337427"))
      .map((path) => relative(publicRoot, path));

    expect(withAppleGlyph).toEqual([LOGO_SRC.slice(1)]);
  });

  it("uses the supplied 16px Figma logo in the sign-in pill without changing account badges", () => {
    render(<ContinueWithApple onContinue={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Continue with Apple" });
    const logo = button.querySelector("img");
    expect(logo).toHaveAttribute("src", "/brand/apple-logo.svg");
    expect(logo).toHaveAttribute("alt", "");
    expect(logo).toHaveClass("size-4");
    expect(logo).toHaveAttribute("width", "16");
    expect(logo).toHaveAttribute("height", "16");
  });

  it("draws the badge from the glyph in Apple's logo file", () => {
    expect(APPLE_GLYPH_PATH).toMatch(/^M12\.2337427/u);
  });

  it("marks an Apple account card with the Apple badge where a Google card has its G", () => {
    const { container } = render(
      <ProviderAccountCard
        account={{ provider: "apple", appleAccount: APPLE_IDENTITY.appleAccount! }}
      />,
    );

    expect(screen.getByText("Jane Appleseed")).toBeInTheDocument();
    expect(screen.getByText("jane@privaterelay.appleid.com")).toBeInTheDocument();
    expect(screen.queryByText("Apple Account")).toBeNull();
    const badge = expectAppleBadge(container);
    expect(badge).toHaveClass("size-4", "shrink-0");
    expect(badge.parentElement?.lastElementChild).toBe(badge);

    cleanup();
    const google = render(
      <ProviderAccountCard
        account={{ provider: "google", googleAccount: GOOGLE_IDENTITY.googleAccount! }}
      />,
    ).container;
    const g = google.querySelector(`svg[viewBox="${GOOGLE_BADGE_VIEWBOX}"]`);
    expect(g?.getAttribute("class")).toBe(badge.getAttribute("class"));
    expect(g?.parentElement?.lastElementChild).toBe(g);
  });

  it.each([
    { name: "Jane Appleseed", email: null, shown: "Jane Appleseed" },
    { name: null, email: "jane@privaterelay.appleid.com", shown: "jane@privaterelay.appleid.com" },
  ])("badges an Apple account card with only $shown", ({ name, email, shown }) => {
    const { container } = render(
      <ProviderAccountCard
        account={{ provider: "apple", appleAccount: { appleSubject: "001234", email, name } }}
      />,
    );

    expect(screen.getByText(shown)).toBeInTheDocument();
    expect(screen.queryByText("Apple Account")).toBeNull();
    expectAppleBadge(container);
  });

  it("names the account type on a badged card without name or email", () => {
    const { container } = render(
      <ProviderAccountCard
        account={{
          provider: "apple",
          appleAccount: { appleSubject: "001234", email: null, name: null },
        }}
      />,
    );

    expect(screen.getAllByText("Apple Account")).toHaveLength(1);
    expect(screen.getByText("Key stored in iCloud")).toBeInTheDocument();
    expectAppleBadge(container);
  });

  it("puts the Apple badge before the email on the identity overview", () => {
    const { container } = render(
      <IdentityOverview identity={APPLE_IDENTITY} onManage={vi.fn()} onSwitch={vi.fn()} />,
    );

    const email = screen.getByText("jane@privaterelay.appleid.com");
    expect(screen.queryByText("Apple Account")).toBeNull();
    const badge = expectAppleBadge(container);
    expect(email.previousElementSibling).toBe(badge);
    expect(badge.parentElement).toHaveClass("flex", "h-10", "items-center", "gap-2");
  });

  it("puts the Apple badge before the iCloud note on an overview without email", () => {
    const { container } = render(
      <IdentityOverview
        identity={{
          ...APPLE_IDENTITY,
          appleAccount: { appleSubject: "001234", email: null, name: "Jane Appleseed" },
        }}
        onManage={vi.fn()}
        onSwitch={vi.fn()}
      />,
    );

    expect(screen.getByText("Key stored in iCloud").previousElementSibling).toBe(
      expectAppleBadge(container),
    );
  });

  it("badges the Apple identity's avatar in the identity switcher, next to a Google one", () => {
    const { container } = render(
      <IdentitySwitcher
        activePublicKeyZ32={APPLE_IDENTITY.publicIdentity.publicKeyZ32}
        identities={[APPLE_IDENTITY, GOOGLE_IDENTITY]}
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const row = screen.getByRole("button", { name: /Jane Appleseed/u });
    expect(row).toHaveAccessibleName("Jane Appleseedjane@privaterelay.appleid.com");
    const badge = expectAppleBadge(row);
    expectAvatarBadge(badge);
    const googleRow = screen.getByRole("button", { name: /Satoshi Nakamoto/u });
    const g = googleRow.querySelector(`svg[viewBox="${GOOGLE_BADGE_VIEWBOX}"]`);
    expect(g?.parentElement?.className).toBe(badge.parentElement?.className);
    expect(container.querySelectorAll(`svg[viewBox="${APPLE_BADGE_VIEWBOX}"]`)).toHaveLength(1);
  });

  it("badges the Apple identity's avatar on the authorization review", () => {
    const { container } = renderReview(APPLE_IDENTITY);

    expect(screen.getByText("Jane Appleseed")).toBeVisible();
    expect(screen.queryByText("Apple Account")).toBeNull();
    expectAvatarBadge(expectAppleBadge(container));
  });

  it("confines Apple artwork to the sign-in pill and the unchanged badge component", () => {
    const root = join(process.cwd(), "src");
    const users = sourceFiles(root)
      .filter((path) => !path.endsWith(".test.tsx") && !path.endsWith(".test.ts"))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return (
          source.includes("sign-in-with-apple/") ||
          source.includes('"/brand/apple-logo.svg"') ||
          source.includes("AppleSignInLogo") ||
          source.includes("M12.2337427") ||
          source.includes(APPLE_CHARACTER) ||
          /\\u\{?F8FF/iu.test(source)
        );
      })
      .map((path) => relative(root, path))
      .sort();

    expect(users).toEqual([
      "client/ui/onboarding/apple/continueWithApple.tsx",
      "client/ui/shared/brand/appleLogo.tsx",
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

function publicFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? publicFiles(path) : [path];
  });
}
