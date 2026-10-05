/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { SignupStep } from "./signupStep";

afterEach(cleanup);

it("names the heading by its text, in sentence case with the accent last", () => {
  render(
    <SignupStep title="Enter your" accent="phone number." description="Pick one.">
      <p>content</p>
    </SignupStep>,
  );
  const heading = screen.getByRole("heading", { level: 1, name: "Enter your phone number." });
  expect(heading).not.toHaveAttribute("aria-label");
});
