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
