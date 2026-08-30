/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it } from "vitest";

import { showCopyConfirmation, showDownloadConfirmation, Sonner } from "./sonner";

describe("Sonner", () => {
  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
    cleanup();
  });

  it("renders the designed copy confirmation", async () => {
    render(<Sonner />);

    const pubky = "x8jpihgjy51fdnaingcp8rum1omfzd6p8bhm7usune41grd97dho5cwy4mra";
    act(() => {
      showCopyConfirmation("Pubky", pubky);
    });

    const message = await screen.findByText("Pubky copied to clipboard");
    expect(screen.getByText("x8jpihgjy51fdnaingcp8rum1omfzd6p...")).toBeInTheDocument();
    expect(screen.queryByText(pubky)).not.toBeInTheDocument();
    expect(message).toBeInTheDocument();
  });

  it("renders the compact homeserver confirmation", async () => {
    render(<Sonner />);

    act(() => {
      showCopyConfirmation("Homeserver", "homeserver-pubky");
    });

    expect(await screen.findByText("Homeserver copied")).toBeInTheDocument();
    expect(screen.queryByText("homeserver-pubky")).not.toBeInTheDocument();
  });

  it("renders a recovery-file download confirmation", async () => {
    render(<Sonner />);

    act(() => {
      showDownloadConfirmation();
    });

    expect(await screen.findByText("File downloaded")).toBeInTheDocument();
  });
});
