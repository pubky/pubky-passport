/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddLinkDialog } from "./addLinkDialog";

const NO_LABEL = "Give this link a label.";
const NO_ADDRESS =
  "Enter a full address with its scheme, like https://example.com or mailto:you@example.com.";

function mount(open = true) {
  const onCancel = vi.fn();
  const onSave = vi.fn<(link: { title: string; url: string }) => void>();
  const view = render(<AddLinkDialog onCancel={onCancel} onSave={onSave} open={open} />);
  const reopen = (next: boolean) =>
    view.rerender(<AddLinkDialog onCancel={onCancel} onSave={onSave} open={next} />);
  return { onCancel, onSave, reopen };
}

type User = ReturnType<typeof userEvent.setup>;

/** Closes the dialog with its button named `name`. */
function pressing(name: string) {
  return (user: User) => user.click(screen.getByRole("button", { name }));
}

/** Escape cancels a modal dialog; jsdom only fires its cancel event when asked to. */
async function pressEscape() {
  fireEvent(
    screen.getByRole("dialog", { name: "Add link" }),
    new Event("cancel", { cancelable: true }),
  );
}

function field(name: "Label" | "URL"): HTMLElement {
  return within(screen.getByRole("dialog", { name: "Add link" })).getByLabelText(name);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AddLinkDialog", () => {
  it("is closed until it is opened", () => {
    mount(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks for a label and an address and hands them on trimmed", async () => {
    const { onSave, onCancel } = mount();
    const user = userEvent.setup();

    expect(screen.getByRole("heading", { name: "Add link" })).toBeInTheDocument();
    // Visible labels name both fields; nothing is refused before Save Link is pressed.
    expect(field("Label")).not.toHaveAttribute("aria-invalid");
    expect(field("URL")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(field("Label"), "  GitHub ");
    await user.type(field("URL"), " https://github.com/satoshi  ");
    await user.click(screen.getByRole("button", { name: "Save Link" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      title: "GitHub",
      url: "https://github.com/satoshi",
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("refuses an empty label or address, saying so at each field", async () => {
    const { onSave } = mount();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Save Link" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(field("Label")).toHaveAttribute("aria-invalid", "true");
    expect(field("Label")).toHaveAccessibleDescription(NO_LABEL);
    expect(field("URL")).toHaveAttribute("aria-invalid", "true");
    expect(field("URL")).toHaveAccessibleDescription(NO_ADDRESS);

    // Spaces alone are no label; each message goes once its field is filled.
    await user.type(field("Label"), "   ");
    await user.type(field("URL"), "https://blog.example");
    expect(field("Label")).toHaveAccessibleDescription(NO_LABEL);
    expect(field("URL")).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: "Save Link" }));
    expect(onSave).not.toHaveBeenCalled();

    await user.type(field("Label"), "Blog");
    expect(field("Label")).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: "Save Link" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      title: "Blog",
      url: "https://blog.example",
    });
  });

  it("refuses a label longer than the specs allow, counting as they do", async () => {
    const { onSave } = mount();
    const user = userEvent.setup();
    await user.click(field("Label"));
    await user.paste("t".repeat(101));
    await user.type(field("URL"), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Save Link" }));

    expect(field("Label")).toHaveAccessibleDescription(
      "Keep the label to 100 characters or fewer (you have 101).",
    );
    expect(onSave).not.toHaveBeenCalled();

    await user.type(field("Label"), "{Backspace}");
    await user.click(screen.getByRole("button", { name: "Save Link" }));
    expect(onSave).toHaveBeenCalledWith({ title: "t".repeat(100), url: "https://example.com" });
  });

  it("fills the address from the clipboard", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "readText").mockResolvedValue("  https://pasted.example \n");
    mount();

    await user.click(screen.getByRole("button", { name: "Paste address" }));
    await waitFor(() => expect(field("URL")).toHaveValue("https://pasted.example"));
  });

  it("keeps the address as it is when the clipboard cannot be read", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "readText").mockRejectedValue(new Error("denied"));
    mount();
    await user.type(field("URL"), "https://typed.example");

    await user.click(screen.getByRole("button", { name: "Paste address" }));
    expect(field("URL")).toHaveValue("https://typed.example");
  });

  it.each([
    ["Cancel", pressing("Cancel")],
    ["Close", pressing("Close")],
    ["Escape", pressEscape],
  ])("closes with %s, adding nothing and keeping nothing typed", async (_, close) => {
    const { onCancel, onSave, reopen } = mount();
    const user = userEvent.setup();
    await user.type(field("Label"), "Blog");
    await user.click(screen.getByRole("button", { name: "Save Link" }));
    expect(field("URL")).toHaveAttribute("aria-invalid", "true");

    await close(user);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();

    reopen(false);
    reopen(true);
    expect(field("Label")).toHaveValue("");
    expect(field("URL")).toHaveValue("");
    expect(field("URL")).not.toHaveAttribute("aria-invalid");
  });

  it("opens empty again after a link was saved", async () => {
    const { onSave, reopen } = mount();
    const user = userEvent.setup();
    await user.type(field("Label"), "Blog");
    await user.type(field("URL"), "https://blog.example");
    await user.click(screen.getByRole("button", { name: "Save Link" }));
    expect(onSave).toHaveBeenCalledOnce();

    reopen(false);
    reopen(true);
    expect(field("Label")).toHaveValue("");
    expect(field("URL")).toHaveValue("");
  });
});
