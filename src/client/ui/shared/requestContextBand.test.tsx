/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RequestContextBand } from "./requestContextBand";

const HOST = "accounts.google.com.sign-in.secure-verify.attacker.example";

describe("RequestContextBand", () => {
  afterEach(cleanup);

  it("keeps the full host in its accessible name and title", () => {
    render(<RequestContextBand label="Signing in to" requester={HOST} />);

    expect(screen.getByLabelText(`Signing in to ${HOST}`)).toBeInTheDocument();
    expect(screen.getByTitle(HOST)).toHaveTextContent(HOST);
  });

  it("cuts a long host at its start so the registrable domain stays visible", () => {
    render(<RequestContextBand label="Signing in to" requester={HOST} />);

    const clip = screen.getByTitle(HOST);
    expect(clip).toHaveClass("truncate");
    expect(clip).toHaveAttribute("dir", "rtl");
    // The host itself still reads left to right inside the right-to-left clip.
    expect(clip.querySelector("bdi")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("Signing in to")).not.toHaveClass("truncate");
  });
});
