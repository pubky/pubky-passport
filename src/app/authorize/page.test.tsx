/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AuthorizePage from "./page";

vi.mock("../../client/ui/authorization/authorizationFlow", () => ({
  AuthorizationFlow: ({ googleClientId, homegateBaseUrl }: {
    googleClientId: string;
    homegateBaseUrl: string;
  }) => <main>{googleClientId}|{homegateBaseUrl}</main>,
}));

describe("AuthorizePage", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example/api");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("renders the authorization feature with browser configuration", () => {
    render(<AuthorizePage />);
    expect(screen.getByText("google-client-id|https://homegate.example/api/")).toBeInTheDocument();
  });
});
