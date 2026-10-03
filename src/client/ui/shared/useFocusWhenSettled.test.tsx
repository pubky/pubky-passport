/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useFocusWhenSettled } from "./useFocusWhenSettled";

function Harness({ busy, when }: { busy: boolean; when?: boolean }) {
  const target = useRef<HTMLInputElement>(null);
  useFocusWhenSettled(target, busy, when);
  return (
    <>
      <button type="button">Elsewhere</button>
      <input aria-label="Target" ref={target} />
    </>
  );
}

describe("useFocusWhenSettled", () => {
  afterEach(cleanup);

  it("focuses the target once the work finishes, not before or on mount", () => {
    const { rerender } = render(<Harness busy={false} />);
    const target = screen.getByLabelText("Target");
    expect(target).not.toHaveFocus();

    screen.getByRole("button", { name: "Elsewhere" }).focus();
    rerender(<Harness busy />);
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();

    rerender(<Harness busy={false} />);
    expect(target).toHaveFocus();
  });

  it("leaves focus alone when the finished work did not produce the target's state", () => {
    const { rerender } = render(<Harness busy when={false} />);
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();

    rerender(<Harness busy={false} when={false} />);
    expect(elsewhere).toHaveFocus();
    // A later change of `when` alone is not a finish.
    rerender(<Harness busy={false} when />);
    expect(elsewhere).toHaveFocus();
  });
});
