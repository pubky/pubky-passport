/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { GoogleIdentityProgress as GoogleIdentityProgressState } from "../../../logic/google-identity/GoogleIdentityController";
import { GoogleIdentityProgress } from "./googleIdentityProgress";

afterEach(cleanup);

describe("GoogleIdentityProgress", () => {
  it("presents Drive lookup without claiming setup or restore", () => {
    render(<GoogleIdentityProgress progress={{ flow: "lookup", step: "checking" }} />);

    const heading = screen.getByRole("heading", { name: "Looking for existing Pubky." });
    expect(heading.children[0]).toHaveTextContent("Looking for");
    expect(screen.getByText("existing Pubky.")).toHaveClass("whitespace-nowrap");
    expect(screen.getByRole("status")).toHaveTextContent("Checking Google Drive");
  });

  it.each([
    [{ flow: "create", step: "preparing" }, "Store Passport file"],
    [{ flow: "create", step: "creating" }, "Store Passport file"],
    [{ flow: "create", step: "storing_passport_file" }, "Store Passport file"],
    [{ flow: "create", step: "signing_up" }, "Sign up to the homeserver"],
    [{ flow: "create", step: "publishing" }, "Publish PKDNS records"],
    [{ flow: "create", step: "activating" }, "Activate identity"],
  ] satisfies Array<[GoogleIdentityProgressState, string]>)(
    "presents %s as the active setup step",
    (progress, activeLabel) => {
      render(<GoogleIdentityProgress progress={progress} />);

      expect(screen.getByRole("heading", { name: "Setting up your pubky." })).toBeInTheDocument();
      expect(
        screen.getByRole("list", { name: "Pubky identity setup progress" }),
      ).toBeInTheDocument();
      expect(screen.getByText(activeLabel).closest("li")).toHaveAttribute("aria-current", "step");
    },
  );

  it.each([
    [{ flow: "restore", step: "restoring" }, "Restoring", "restore", "Restore Passport file"],
    [{ flow: "restore", step: "signing_in" }, "Restoring", "restore", "Sign in to the homeserver"],
    [{ flow: "repair", step: "signing_up" }, "Repairing", "repair", "Repair homeserver access"],
    [{ flow: "repair", step: "publishing" }, "Repairing", "repair", "Publish PKDNS records"],
    [{ flow: "repair", step: "signing_in" }, "Repairing", "repair", "Sign in to the homeserver"],
  ] satisfies Array<[GoogleIdentityProgressState, string, string, string]>)(
    "presents %s as the active %s step",
    (progress, heading, branch, activeLabel) => {
      render(<GoogleIdentityProgress progress={progress} />);

      expect(screen.getByRole("heading", { name: `${heading} your pubky.` })).toBeInTheDocument();
      expect(
        screen.getByRole("list", { name: `Pubky identity ${branch} progress` }),
      ).toBeInTheDocument();
      expect(screen.getByText(activeLabel).closest("li")).toHaveAttribute("aria-current", "step");
      expect(screen.getByRole("status")).toHaveTextContent(
        `${heading} your Pubky: ${activeLabel}.`,
      );
    },
  );
});
