/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { GoogleIdentityProgress as GoogleIdentityProgressState } from "@/client/logic/google-identity/GoogleIdentityController";
import { GoogleIdentityProgress } from "./googleIdentityProgress";

afterEach(cleanup);

describe("GoogleIdentityProgress", () => {
  it("presents the Drive lookup as the first step of the shared progress screen", () => {
    render(<GoogleIdentityProgress progress={{ flow: "lookup", step: "checking" }} />);

    const heading = screen.getByRole("heading", { name: "Looking for your pubky." });
    expect(heading.parentElement).toHaveClass("gap-6", "md:gap-8");
    const lookupProgress = screen.getByRole("list", { name: "Pubky identity lookup progress" });
    expect(within(lookupProgress).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Check Google Drive for a backup").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Looking for your Pubky: Check Google Drive for a backup.",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([
    [{ flow: "create", step: "preparing" }, "Store encrypted backup"],
    [{ flow: "create", step: "creating" }, "Store encrypted backup"],
    [{ flow: "create", step: "storing_passport_file" }, "Store encrypted backup"],
    [{ flow: "create", step: "signing_up" }, "Sign up to the homeserver"],
    [{ flow: "create", step: "publishing" }, "Publish PKDNS records"],
    [{ flow: "create", step: "activating" }, "Activate identity"],
  ] satisfies Array<[GoogleIdentityProgressState, string]>)(
    "presents %s as the active setup step",
    (progress, activeLabel) => {
      render(<GoogleIdentityProgress progress={progress} />);

      const heading = screen.getByRole("heading", { name: "Setting up your pubky." });
      expect(heading.parentElement).toHaveClass("gap-6", "md:gap-8");
      const setupProgress = screen.getByRole("list", {
        name: "Pubky identity setup progress",
      });
      expect(setupProgress).not.toHaveClass(
        "rounded-lg",
        "border",
        "border-card",
        "md:rounded-lg",
        "md:border",
        "md:border-card",
      );
      expect(screen.getByText(activeLabel).closest("li")).toHaveAttribute("aria-current", "step");
      expect(within(setupProgress).getAllByRole("listitem")[0]).toHaveTextContent(
        "Check Google Drive for a backup (complete)",
      );
    },
  );

  it.each([
    [{ flow: "restore", step: "restoring" }, "Looking for", "restore", "Restore encrypted backup"],
    [
      { flow: "restore", step: "signing_in" },
      "Looking for",
      "restore",
      "Sign in to the homeserver",
    ],
    [{ flow: "repair", step: "signing_up" }, "Repairing", "repair", "Repair homeserver access"],
    [{ flow: "repair", step: "publishing" }, "Repairing", "repair", "Publish PKDNS records"],
    [{ flow: "repair", step: "signing_in" }, "Repairing", "repair", "Sign in to the homeserver"],
  ] satisfies Array<[GoogleIdentityProgressState, string, string, string]>)(
    "presents %s as the active %s step",
    (progress, heading, branch, activeLabel) => {
      render(<GoogleIdentityProgress progress={progress} />);

      expect(screen.getByRole("heading", { name: `${heading} your pubky.` })).toBeInTheDocument();
      const progressList = screen.getByRole("list", {
        name: `Pubky identity ${branch} progress`,
      });
      expect(progressList).not.toHaveClass("border", "md:border");
      expect(within(progressList).getAllByRole("listitem")[0]).toHaveTextContent(
        "Check Google Drive for a backup (complete)",
      );
      expect(screen.getByText(activeLabel).closest("li")).toHaveAttribute("aria-current", "step");
      expect(screen.getByRole("status")).toHaveTextContent(
        `${heading} your Pubky: ${activeLabel}.`,
      );
    },
  );
});
