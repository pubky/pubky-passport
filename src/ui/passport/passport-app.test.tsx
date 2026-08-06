/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    FLOW.catalog = { activeIdentityId: "identity", identities: [{ id: "identity", publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" }, googleAccount: { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null } }] };
    render(<PassportApp googleClientId="client" homegateBaseUrl="https://homegate.example/" />);
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    expect(screen.getByText("identity")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Quick & easy signing." })).not.toBeInTheDocument();
  });

  it("shows the active identity when several identities exist", async () => {
    FLOW.catalog = {
      activeIdentityId: "second",
      identities: [
        { id: "first", publicIdentity: { publicKeyZ32: "first", publicKeyDisplay: "pubkyfirst" } },
        { id: "second", publicIdentity: { publicKeyZ32: "second", publicKeyDisplay: "pubkysecond" }, googleAccount: { id: "google-2", email: "active@gmail.com", name: "Active Account", pictureUrl: null } },
      ],
    };
    render(<PassportApp googleClientId="client" homegateBaseUrl="https://homegate.example/" />);

    expect(await screen.findByText("Active Account")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.queryByText("first")).not.toBeInTheDocument();
  });

  it("opens the switcher and sends Add identity to the signing flow", async () => {
    FLOW.catalog = { activeIdentityId: "identity", identities: [{ id: "identity", publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" } }] };
    render(<PassportApp googleClientId="client" homegateBaseUrl="https://homegate.example/" />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Switch" }));
    expect(screen.getByRole("heading", { name: "Switch identity." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));

    expect(await screen.findByRole("heading", { name: "Quick & easy signing." })).toBeInTheDocument();
  });
});
