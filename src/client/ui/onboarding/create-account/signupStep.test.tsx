/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { SignupStep } from "./signupStep";

afterEach(cleanup);

it("gives a heading with viewport-specific wording a single accessible name", () => {
  render(
    <SignupStep title="Scan to" mobileTitle="Tap to" accent="Pay." description="Pay now.">
      <p>content</p>
    </SignupStep>,
  );
  expect(screen.getByRole("heading", { level: 1, name: "Scan to Pay." })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Tap to/u })).not.toBeInTheDocument();
});

it("leaves single-wording headings named by their text", () => {
  render(
    <SignupStep title="Choose" accent="your signer." description="Pick one.">
      <p>content</p>
    </SignupStep>,
  );
  const heading = screen.getByRole("heading", { level: 1, name: "Choose your signer." });
  expect(heading).not.toHaveAttribute("aria-label");
});
