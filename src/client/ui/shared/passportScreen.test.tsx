/** @vitest-environment jsdom */

import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PassportScreen } from "./passportScreen";

describe("PassportScreen", () => {
  afterEach(cleanup);

  it("is one centred 375px column with 24px padding at every width", () => {
    render(<PassportScreen />);
    const main = screen.getByRole("main");
    expect(main).toHaveClass("mx-auto", "w-full", "max-w-[375px]", "px-6");
    // No breakpoint widens it or drops its padding.
    expect(main.className).not.toMatch(/md:(max-w|w|px)-/u);
  });
});

/** Files that may still use breakpoints: page chrome, dialogs, and desktop-only device behaviour. */
const MD_ALLOWED = new Set([
  // Header band, footer and the Terms/Privacy reading layout stay full width.
  "authorization/signInBand.tsx",
  "shared/passportFooter.tsx",
  "shared/legal/legalPage.tsx",
  // The column's own vertical padding under the taller desktop header.
  "shared/passportScreen.tsx",
  // Bottom sheets on phones, centred 375px dialogs on wider screens.
  "onboarding/signInHelpDrawer.tsx",
  "shared/confirmDeletionDialog.tsx",
  "identity-dashboard/management/authorized-apps/authorizedAppDialog.tsx",
  // A computer shows the Pubky Ring QR inline; a phone gets Show QR and Import pubky.
  "identity-dashboard/management/migrate-to-pubky-ring/migrateToPubkyRing.tsx",
]);

describe("screens", () => {
  it("use the same one-column layout at every width", () => {
    const root = join(process.cwd(), "src", "client", "ui");
    const offenders = readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
      .filter((file) => !MD_ALLOWED.has(file.split(sep).join("/")))
      .filter((file) =>
        /(?<![A-Za-z0-9-])(?:max-)?(?:sm|md|lg|xl|2xl):[^\s"'`]/u.test(
          readFileSync(join(root, file), "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
