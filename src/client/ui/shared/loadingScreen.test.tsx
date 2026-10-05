/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LoadingScreen } from "./loadingScreen";

describe("LoadingScreen", () => {
  afterEach(cleanup);

  it("names the wait with a heading and visible text", () => {
    render(<LoadingScreen label="Loading Passport" />);

    const main = screen.getByRole("main", { name: "Loading Passport" });
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { level: 1, name: "Loading Passport" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Opening Passport…");
  });
});
