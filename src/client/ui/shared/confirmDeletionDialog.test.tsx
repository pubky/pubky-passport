/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmDeletionDialog } from "./confirmDeletionDialog";

function renderDialog() {
  const onConfirm = vi.fn();
  render(
    <ConfirmDeletionDialog
      confirmLabel="Discard invite"
      id="discard"
      onCancel={vi.fn()}
      onConfirm={onConfirm}
      open
      title="Discard this invite?"
    />,
  );
  return {
    onConfirm,
    field: screen.getByRole("textbox", { name: "Type DELETE to confirm" }),
    confirm: screen.getByRole("button", { name: "Discard invite" }),
  };
}

describe("ConfirmDeletionDialog", () => {
  afterEach(cleanup);

  it.each(["DELETE", "delete", "Delete", "DELETE ", " Delete"])(
    "accepts %j, however a phone keyboard capitalised or spaced it",
    async (typed) => {
      const { confirm, field, onConfirm } = renderDialog();
      expect(confirm).toBeDisabled();
      await userEvent.setup().type(field, typed);
      expect(confirm).toBeEnabled();
      await userEvent.setup().click(confirm);
      expect(onConfirm).toHaveBeenCalledOnce();
    },
  );

  it("keeps the destructive action closed for any other word", async () => {
    const { confirm, field, onConfirm } = renderDialog();
    await userEvent.setup().type(field, "DELET{Enter}");
    expect(confirm).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("asks the keyboard for capitals and no corrections", () => {
    const { field } = renderDialog();
    expect(field).toHaveAttribute("autocapitalize", "characters");
    expect(field).toHaveAttribute("autocorrect", "off");
    expect(field).toHaveAttribute("spellcheck", "false");
  });
});
