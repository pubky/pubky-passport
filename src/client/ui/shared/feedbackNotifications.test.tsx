/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it } from "vitest";

import { showFileDownloaded, showHomeserverCopied, showPubkyCopied } from "./feedbackNotifications";
import { Sonner } from "./sonner";

describe("feedback notifications", () => {
  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
    cleanup();
  });

  it("renders the Pubky confirmation with a shortened key", async () => {
    render(<Sonner />);

    const pubky = "x8jpihgjy51fdnaingcp8rum1omfzd6p8bhm7usune41grd97dho5cwy4mra";
    act(() => {
      showPubkyCopied(pubky);
    });

    expect(await screen.findByText("Pubky copied to clipboard")).toBeInTheDocument();
    expect(screen.getByText("x8jpihgjy51fdnaingcp8rum1omfzd6p...")).toBeInTheDocument();
    expect(screen.queryByText(pubky)).not.toBeInTheDocument();
  });

  it("renders the compact Homeserver confirmation", async () => {
    render(<Sonner />);

    act(() => {
      showHomeserverCopied();
    });

    expect(await screen.findByText("Homeserver copied")).toBeInTheDocument();
  });

  it("renders the recovery-file download confirmation", async () => {
    render(<Sonner />);

    act(() => {
      showFileDownloaded();
    });

    expect(await screen.findByText("File downloaded")).toBeInTheDocument();
  });
});
