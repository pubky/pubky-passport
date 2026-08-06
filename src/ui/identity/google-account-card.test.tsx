/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GoogleAccountCard } from "./google-account-card";

describe("GoogleAccountCard", () => {
  afterEach(cleanup);

  it("shows the Google account associated with an identity", () => {
    render(<GoogleAccountCard account={{ id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: "https://lh3.googleusercontent.com/avatar" }} />);

    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    expect(screen.getByText("satoshi@gmail.com")).toBeInTheDocument();
  });
});
