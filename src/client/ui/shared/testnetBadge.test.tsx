/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { TestnetBadge } from "./testnetBadge";

afterEach(cleanup);

it("shows a visible Testnet badge on a testnet instance only", () => {
  const { container, rerender } = render(<TestnetBadge network="mainnet" />);
  expect(container).toBeEmptyDOMElement();
  rerender(<TestnetBadge network="testnet" />);
  const badge = screen.getByText("Testnet");
  expect(badge).toBeVisible();
  expect(badge).toHaveAttribute("title", expect.stringContaining("for testing only"));
});
