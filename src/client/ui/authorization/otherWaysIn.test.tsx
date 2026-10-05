/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { OtherWaysIn } from "./otherWaysIn";

afterEach(cleanup);

it("offers the start page and Pubky Ring below an or, neither as the primary action", async () => {
  const onOpenRing = vi.fn();
  const onUseAnotherIdentity = vi.fn();
  render(<OtherWaysIn onOpenRing={onOpenRing} onUseAnotherIdentity={onUseAnotherIdentity} />);

  const or = screen.getByText("or", { exact: true });
  const another = screen.getByRole("button", { name: "Use another identity" });
  const ring = screen.getByRole("button", { name: "Continue with Pubky Ring" });
  for (const button of [another, ring]) {
    expect(button).toHaveClass("bg-secondary");
    expect(or.compareDocumentPosition(button)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  }
  expect(another.compareDocumentPosition(ring)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

  const user = userEvent.setup();
  await user.click(another);
  await user.click(ring);
  expect(onUseAnotherIdentity).toHaveBeenCalledOnce();
  expect(onOpenRing).toHaveBeenCalledOnce();
});

it("starts nothing while an answer is on its way", async () => {
  const onOpenRing = vi.fn();
  const onUseAnotherIdentity = vi.fn();
  render(
    <OtherWaysIn disabled onOpenRing={onOpenRing} onUseAnotherIdentity={onUseAnotherIdentity} />,
  );

  const user = userEvent.setup();
  for (const name of ["Use another identity", "Continue with Pubky Ring"]) {
    const button = screen.getByRole("button", { name });
    expect(button).toBeDisabled();
    await user.click(button);
  }
  expect(onUseAnotherIdentity).not.toHaveBeenCalled();
  expect(onOpenRing).not.toHaveBeenCalled();
});
