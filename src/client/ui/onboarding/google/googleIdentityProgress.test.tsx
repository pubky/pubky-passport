/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { GoogleIdentityProgress as GoogleIdentityProgressState } from "@/client/logic/google-identity/GoogleIdentityController";
import { GoogleIdentityProgress } from "./googleIdentityProgress";

const HOMESERVER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";

afterEach(cleanup);

describe("GoogleIdentityProgress", () => {
  it.each([
    { flow: "lookup", step: "checking" },
    { flow: "restore", step: "restoring" },
    { flow: "restore", step: "signing_in" },
  ] satisfies GoogleIdentityProgressState[])(
    "keeps %s on the steady loading screen without a step list",
    (progress) => {
      render(<GoogleIdentityProgress progress={progress} />);

      const heading = screen.getByRole("heading", { name: "Loading your pubky." });
      // Heading and lead as one block, the spinner below it at the step spacing.
      expect(heading.parentElement).toHaveClass("gap-3");
      expect(heading.parentElement?.parentElement).toHaveClass("gap-6", "md:gap-8");
      // Closing the window mid-setup drops the work, so the screen says to keep it open.
      expect(heading.nextElementSibling).toHaveTextContent(
        "This takes a few seconds. Keep this window open.",
      );
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Loading your pubky.");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it("heads account creation with the Google setup stepper, and a lookup or restore without it", () => {
    render(<GoogleIdentityProgress progress={{ flow: "create", step: "signing_up" }} />);
    const stepper = screen.getByRole("navigation", { name: "Account setup progress" });
    expect(within(stepper).getByText("Google backup").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    // The same space under the stepper as every other step.
    expect(screen.getByRole("main")).toHaveClass("gap-6", "md:gap-8");
    cleanup();

    render(<GoogleIdentityProgress progress={{ flow: "restore", step: "restoring" }} />);
    expect(screen.queryByRole("navigation", { name: "Account setup progress" })).toBeNull();
  });

  it.each([
    { flow: "create", step: "signing_up", homeserverPubky: HOMESERVER },
    { flow: "repair", step: "publishing", homeserverPubky: HOMESERVER },
  ] satisfies GoogleIdentityProgressState[])(
    "names the homeserver Homegate issued the invite for while it is used ($flow)",
    (progress) => {
      render(<GoogleIdentityProgress progress={progress} />);
      expect(screen.getByText("Homeserver")).toBeInTheDocument();
      expect(screen.getByText(HOMESERVER)).toBeInTheDocument();
    },
  );

  it("names no homeserver before Homegate has issued the invite", () => {
    render(<GoogleIdentityProgress progress={{ flow: "create", step: "preparing" }} />);
    expect(screen.queryByText("Homeserver")).not.toBeInTheDocument();
  });

  it.each([
    [{ flow: "create", step: "preparing" }, "Save encrypted backup to Google Drive"],
    [{ flow: "create", step: "creating" }, "Save encrypted backup to Google Drive"],
    [{ flow: "create", step: "storing_passport_file" }, "Save encrypted backup to Google Drive"],
    [{ flow: "create", step: "signing_up" }, "Create your account"],
    [{ flow: "create", step: "publishing" }, "Publish your pubky so apps can find it"],
    [{ flow: "create", step: "activating" }, "Finish setup"],
  ] satisfies Array<[GoogleIdentityProgressState, string]>)(
    "presents %s as the active setup step",
    (progress, activeLabel) => {
      render(<GoogleIdentityProgress progress={progress} />);

      const heading = screen.getByRole("heading", { name: "Setting up your pubky." });
      expect(heading.parentElement?.parentElement).toHaveClass("gap-6", "md:gap-8");
      const setupProgress = screen.getByRole("list", {
        name: "Steps to set up your pubky",
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
    [{ flow: "repair", step: "signing_up" }, "Finish your earlier setup"],
    [{ flow: "repair", step: "publishing" }, "Publish your pubky so apps can find it"],
    [{ flow: "repair", step: "signing_in" }, "Sign in"],
  ] satisfies Array<[GoogleIdentityProgressState, string]>)(
    "presents %s as the active repair step",
    (progress, activeLabel) => {
      render(<GoogleIdentityProgress progress={progress} />);

      expect(screen.getByRole("heading", { name: "Repairing your pubky." })).toBeInTheDocument();
      const progressList = screen.getByRole("list", {
        name: "Steps to repair your pubky",
      });
      expect(progressList).not.toHaveClass("border", "md:border");
      expect(within(progressList).getAllByRole("listitem")[0]).toHaveTextContent(
        "Check Google Drive for a backup (complete)",
      );
      expect(screen.getByText(activeLabel).closest("li")).toHaveAttribute("aria-current", "step");
      expect(screen.getByRole("status")).toHaveTextContent(`Repairing your pubky: ${activeLabel}.`);
    },
  );
});
