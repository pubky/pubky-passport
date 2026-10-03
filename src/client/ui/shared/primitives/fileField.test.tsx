/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileField } from "./fileField";

describe("FileField", () => {
  afterEach(cleanup);

  it("keeps the native input as the one labelled control and echoes the picked file", async () => {
    const onChange = vi.fn();
    const ref = createRef<HTMLInputElement>();
    render(
      <>
        <label htmlFor="backup">Pubky backup</label>
        <FileField accept=".pkarr" id="backup" onChange={onChange} ref={ref} />
      </>,
    );
    const input = screen.getByLabelText("Pubky backup");
    expect(input).toBe(ref.current);
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".pkarr");
    // The echo is visual only; the browser announces the chosen file itself.
    expect(screen.getByText("Choose file").closest("[aria-hidden]")).not.toBeNull();
    expect(screen.getByText("No file chosen")).toHaveAttribute("aria-hidden", "true");

    const name = "pubky-tkrq8zmwb8e3y5nqu4hxp7qy.pkarr";
    await userEvent.setup().upload(input as HTMLInputElement, new File(["backup"], name));

    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByText("Change file")).toBeInTheDocument();
    // Cut in the middle: the head gives way, the key's end and the extension stay in view.
    const shown = input.parentElement?.querySelector('[data-slot="file-name"]');
    expect(shown).toHaveTextContent(name);
    // Beside the pill while 8rem is left for it, on its own line in a narrower box.
    expect(shown).toHaveClass("flex-[1_1_8rem]");
    expect(input.parentElement).toHaveClass("flex-wrap");
    const [head, tail] = Array.from(shown?.children ?? []);
    expect(head).toHaveTextContent("pubky-tkrq8zmwb8e3y5nq");
    expect(head).toHaveClass("min-w-0", "text-ellipsis");
    expect(tail).toHaveTextContent("u4hxp7qy.pkarr");
    expect(tail).toHaveClass("shrink-0");
    // The input covers the box, so its tooltip is the one place the whole name shows.
    expect(input).toHaveAttribute("title", name);
  });

  it.each([
    ["short.pkarr", ["", "short.pkarr"]],
    ["no-extension-but-long-name", ["no-extension-but-l", "ong-name"]],
    [".pkarr", ["", ".pkarr"]],
  ])("splits %s where it may be cut", async (name, parts) => {
    render(<FileField aria-label="Backup" />);
    await userEvent
      .setup()
      .upload(screen.getByLabelText("Backup") as HTMLInputElement, new File(["x"], name));

    const shown = document.querySelector('[data-slot="file-name"]');
    expect(Array.from(shown?.children ?? [], (part) => part.textContent)).toEqual(parts);
  });

  it("covers the whole box with the input and marks the box invalid or disabled", () => {
    render(<FileField aria-invalid aria-label="Backup" disabled />);

    const input = screen.getByLabelText("Backup");
    expect(input).toHaveClass("absolute", "inset-0", "opacity-0");
    expect(input).toBeDisabled();
    expect(input.parentElement).toHaveClass(
      "has-[[aria-invalid=true]]:border-destructive",
      "has-[:disabled]:opacity-50",
    );
  });

  it("never shows a kept file the browser cannot put back into the input", () => {
    // jsdom, like browsers without a DataTransfer constructor, cannot fill a file input.
    render(
      <>
        <label htmlFor="kept">Pubky backup</label>
        <FileField defaultFile={new File(["backup"], "pubky-kept.pkarr")} id="kept" />
      </>,
    );
    expect(screen.getByText("No file chosen")).toBeInTheDocument();
    expect(screen.queryByText(/pubky-kept/u)).not.toBeInTheDocument();
    expect((screen.getByLabelText("Pubky backup") as HTMLInputElement).files).toHaveLength(0);
  });
});
