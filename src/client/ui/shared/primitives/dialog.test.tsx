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

  it("focuses its data-autofocus field when it opens, not the first button", () => {
    const content = (
      <>
        <button type="button">Close</button>
        <input aria-label="Label" data-autofocus />
      </>
    );
    const rendered = render(
      <Dialog aria-label="Add link" onOpenChange={() => undefined} open={false}>
        {content}
      </Dialog>,
    );
    rendered.rerender(
      <Dialog aria-label="Add link" onOpenChange={() => undefined} open>
        {content}
      </Dialog>,
    );

    expect(screen.getByRole("textbox", { name: "Label" })).toHaveFocus();
  });

  it("gives confirmations one shared sheet style that a caller can extend", () => {
    render(
      <Dialog
        aria-label="Discard your changes?"
        className="text-base"
        onOpenChange={() => undefined}
        open
        variant="sheet"
      />,
    );

    // A bottom sheet on a phone, a centred card from sm, with the caller's class added.
    expect(screen.getByRole("dialog")).toHaveClass(
      "mt-auto",
      "rounded-t-xl",
      "sm:m-auto",
      "sm:max-w-[375px]",
      "text-base",
    );
  });

  it("returns focus to the control that opened it when it is unmounted", () => {
    const rendered = render(
      <>
        <button type="button">Scan QR</button>
      </>,
    );
    const opener = screen.getByRole("button", { name: "Scan QR" });
    opener.focus();
    rendered.rerender(
      <>
        <button type="button">Scan QR</button>
        <Dialog aria-label="Scanner" onOpenChange={() => undefined} open>
          <button type="button">Close</button>
        </Dialog>
      </>,
    );
    screen.getByRole("button", { name: "Close" }).focus();

    rendered.rerender(
      <>
        <button type="button">Scan QR</button>
      </>,
    );

    expect(opener).toHaveFocus();
  });
});
