/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it } from "vitest";

import { Sonner } from "./sonner";

describe("Sonner", () => {
  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
    cleanup();
  });

  it("renders a default notification with a description", async () => {
    render(<Sonner />);

    act(() => {
      toast("Copied", { description: "Copied value" });
    });

    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(screen.getByText("Copied value")).toBeInTheDocument();
  });

  it("renders a success notification", async () => {
    render(<Sonner />);

    act(() => {
      toast.success("Saved");
    });

    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});
