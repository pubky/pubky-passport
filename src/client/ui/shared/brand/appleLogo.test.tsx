/** @vitest-environment jsdom */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
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

/** No Apple artwork of any kind: no image, no inline SVG. */
function expectNoAppleLogo(container: HTMLElement) {
  expect(container.querySelector(`img[src*="sign-in-with-apple"]`)).toBeNull();
  expect(container.querySelector("svg path[d^='M12.2337427']")).toBeNull();
  expect(container.textContent).not.toContain(APPLE_CHARACTER);
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

  it("puts Apple's logo file in the Sign in with Apple button at the button's full height", () => {
    render(<ContinueWithApple onContinue={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Continue with Apple" });
    const logo = button.querySelector("img");
    expect(logo).toHaveAttribute("src", LOGO_SRC);
    expect(logo).toHaveAttribute("alt", "");
    expect(logo).toHaveClass("h-full", "w-auto");
    expect(button).toHaveClass("py-0");
  });

  it("names the Apple Account in text on the account card", () => {
    const { container } = render(
      <ProviderAccountCard
        account={{ provider: "apple", appleAccount: APPLE_IDENTITY.appleAccount! }}
      />,
    );

    expect(screen.getByText("Apple Account")).toBeInTheDocument();
    expect(screen.getByText("Jane Appleseed")).toBeInTheDocument();
    expectNoAppleLogo(container);
  });

  it.each([
    { name: "Jane Appleseed", email: null, shown: "Jane Appleseed" },
    { name: null, email: "jane@privaterelay.appleid.com", shown: "jane@privaterelay.appleid.com" },
  ])("names the Apple Account once on a card with only $shown", ({ name, email, shown }) => {
    const { container } = render(
      <ProviderAccountCard
        account={{ provider: "apple", appleAccount: { appleSubject: "001234", email, name } }}
      />,
    );

    expect(screen.getByText(shown)).toBeInTheDocument();
    expect(screen.getAllByText("Apple Account")).toHaveLength(1);
    expectNoAppleLogo(container);
  });

  it("names the Apple Account once on a card without name or email", () => {
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
    expectNoAppleLogo(container);
  });

  it("names the Apple Account in text on the identity overview", () => {
    const { container } = render(
      <IdentityOverview identity={APPLE_IDENTITY} onManage={vi.fn()} onSwitch={vi.fn()} />,
    );

    expect(screen.getByText("Apple Account")).toBeInTheDocument();
    expect(screen.getByText("jane@privaterelay.appleid.com")).toBeInTheDocument();
    expectNoAppleLogo(container);
  });

  it("names the Apple Account in text in the identity switcher", () => {
    const { container } = render(
      <IdentitySwitcher
        activePublicKeyZ32={APPLE_IDENTITY.publicIdentity.publicKeyZ32}
        identities={[APPLE_IDENTITY]}
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Jane Appleseed.*Apple Account/u })).toBeVisible();
    expectNoAppleLogo(container);
  });

  it("is used only by the Sign in with Apple button", () => {
    const root = join(process.cwd(), "src");
    const users = sourceFiles(root)
      .filter((path) => !path.endsWith(".test.tsx") && !path.endsWith(".test.ts"))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return (
          source.includes("sign-in-with-apple/") ||
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
