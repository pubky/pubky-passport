/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { IdentityProgress as IdentityProgressState } from "@/client/logic/identity-lifecycle/PassportFileIdentityLifecycle";
import { IdentityProgress } from "./identityProgress";

afterEach(cleanup);

describe("IdentityProgress", () => {
  it.each([
    { flow: "lookup", step: "checking" },
    { flow: "restore", step: "restoring" },
    { flow: "restore", step: "signing_in" },
  ] satisfies IdentityProgressState[])(
    "keeps %s on the steady loading screen without a step list",
    (progress) => {
      render(<IdentityProgress storageName="Google Drive" progress={progress} />);

      const heading = screen.getByRole("heading", { name: "Loading your pubky." });
      expect(heading.parentElement).toHaveClass("gap-6");
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Loading your Pubky.");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it.each([
    [{ flow: "create", step: "preparing" }, "Store encrypted backup"],
    [{ flow: "create", step: "creating" }, "Store encrypted backup"],
    [{ flow: "create", step: "storing_passport_file" }, "Store encrypted backup"],
    [{ flow: "create", step: "signing_up" }, "Sign up to the homeserver"],
    [{ flow: "create", step: "publishing" }, "Publish PKDNS records"],
    [{ flow: "create", step: "activating" }, "Activate identity"],
  ] satisfies Array<[IdentityProgressState, string]>)(
    "presents %s as the active setup step",
    (progress, activeLabel) => {
      render(<IdentityProgress storageName="Google Drive" progress={progress} />);

      const heading = screen.getByRole("heading", { name: "Setting up your pubky." });
      expect(heading.parentElement).toHaveClass("gap-6");
      const setupProgress = screen.getByRole("list", {
        name: "Pubky identity setup progress",
      });
      expect(setupProgress).not.toHaveClass("rounded-lg", "border", "border-card");
      expect(screen.getByText(activeLabel).closest("li")).toHaveAttribute("aria-current", "step");
      expect(within(setupProgress).getAllByRole("listitem")[0]).toHaveTextContent(
        "Check Google Drive for a backup (complete)",
      );
    },
  );

  it.each([
    [{ flow: "repair", step: "signing_up" }, "Repair homeserver access"],
    [{ flow: "repair", step: "publishing" }, "Publish PKDNS records"],
    [{ flow: "repair", step: "signing_in" }, "Sign in to the homeserver"],
  ] satisfies Array<[IdentityProgressState, string]>)(
    "presents %s as the active repair step",
    (progress, activeLabel) => {
      render(<IdentityProgress storageName="Google Drive" progress={progress} />);

      expect(screen.getByRole("heading", { name: "Repairing your pubky." })).toBeInTheDocument();
      const progressList = screen.getByRole("list", {
        name: "Pubky identity repair progress",
      });
      expect(progressList).not.toHaveClass("border");
      expect(within(progressList).getAllByRole("listitem")[0]).toHaveTextContent(
        "Check Google Drive for a backup (complete)",
      );
      expect(screen.getByText(activeLabel).closest("li")).toHaveAttribute("aria-current", "step");
      expect(screen.getByRole("status")).toHaveTextContent(`Repairing your Pubky: ${activeLabel}.`);
    },
  );
});
