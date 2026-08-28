/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Dialog } from "./dialog";

describe("Dialog", () => {
  afterEach(cleanup);

  it("opens modally and closes before unmount", () => {
    const rendered = render(
      <Dialog aria-label="Confirmation" onOpenChange={() => undefined} open />,
    );
    const dialog = screen.getByRole("dialog") as HTMLDialogElement;

    expect(dialog.open).toBe(true);
    rendered.unmount();
    expect(dialog.open).toBe(false);
  });
});
