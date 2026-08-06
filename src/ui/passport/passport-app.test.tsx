/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PassportIdentityList } from "../../browser/identity/passportIdentity";
import { mockPassportIdentityController } from "../../../test-utils/fakes/mockPassportIdentityController";
import { PassportApp } from "./passport-app";

const FLOW = vi.hoisted(() => ({ catalog: { activeIdentityId: null, identities: [] } as PassportIdentityList, refresh: null as (() => void) | null }));

vi.mock("../../browser/identity/passportIdentity", () => ({
  createPassportIdentityController: () => mockPassportIdentityController({
    list: () => Result.ok(FLOW.catalog),
    subscribe: (listener: () => void) => { FLOW.refresh = listener; return () => { FLOW.refresh = null; }; },
  }),
}));

describe("PassportApp", () => {
  beforeEach(() => {
    FLOW.catalog = { activeIdentityId: null, identities: [] };
    FLOW.refresh = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the landing page when no local identity exists", async () => {
    render(<PassportApp googleClientId="client" homegateBaseUrl="https://homegate.example/" />);
    expect(await screen.findByRole("heading", { name: "Quick & easy signing." })).toBeInTheDocument();
  });

  it("routes a stored identity to the signed-in home state", async () => {
    FLOW.catalog = { activeIdentityId: "identity", identities: [{ id: "identity", publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" } }] };
    const { container } = render(<PassportApp googleClientId="client" homegateBaseUrl="https://homegate.example/" />);
    await waitFor(() => expect(container.querySelector('[data-root-state="signed-in"]')).not.toBeNull());
    expect(screen.queryByRole("heading", { name: "Quick & easy signing." })).not.toBeInTheDocument();
  });
});
