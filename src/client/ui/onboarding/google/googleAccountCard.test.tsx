/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GoogleAccountCard } from "./googleAccountCard";

describe("GoogleAccountCard", () => {
  afterEach(cleanup);

  it("shows the address as it is written, not in spaced capitals", () => {
    render(
      <GoogleAccountCard
        account={{
          googleSubject: "google-1",
          email: "alex.rivera@example.com",
          name: "Alex Rivera",
          pictureUrl: null,
        }}
      />,
    );

    const email = screen.getByText("alex.rivera@example.com");
    expect(email).not.toHaveClass("uppercase");
    expect(email).toHaveClass("tracking-normal");
    expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
  });
});
