/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityCatalog } from "../../browser/identity/passportIdentityController";
import { useIdentityCatalog } from "./useIdentityCatalog";

const MOCKS = vi.hoisted(() => ({
  catalog: { activeIdentityId: null, identities: [] } as LocalIdentityCatalog,
  create: vi.fn(),
  unavailable: false,
}));

vi.mock("../../browser/identity/passportIdentityController", () => ({
  PassportIdentityController: function PassportIdentityController() {
    MOCKS.create();
    return {
      listIdentities: () => MOCKS.unavailable
        ? Result.err({ code: "storage_unavailable" as const })
        : Result.ok(MOCKS.catalog),
    };
  },
}));

function SessionProbe() {
  const session = useIdentityCatalog("client", "https://homegate.example/");
  return session.status === "ready"
    ? <><p>{`${session.status}:${session.catalog.identities.length}`}</p><button onClick={session.reloadIdentities} type="button">Reload</button></>
    : <p>{session.status}</p>;
}

describe("useIdentityCatalog", () => {
  beforeEach(() => {
    MOCKS.catalog = { activeIdentityId: null, identities: [] };
    MOCKS.unavailable = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reloads the identity catalog explicitly", async () => {
    render(<SessionProbe />);
    expect(await screen.findByText("ready:0")).toBeInTheDocument();

    MOCKS.catalog = {
      activeIdentityId: "identity",
      identities: [{ id: "identity", publicIdentity: { publicKeyDisplay: "pubkyidentity", publicKeyZ32: "identity" } }],
    };
    await userEvent.setup().click(screen.getByRole("button", { name: "Reload" }));

    expect(await screen.findByText("ready:1")).toBeInTheDocument();
  });

  it("maps catalog failures", async () => {
    MOCKS.unavailable = true;
    render(<SessionProbe />);
    expect(await screen.findByText("unavailable")).toBeInTheDocument();
  });

  it("creates one live controller under Strict Mode", async () => {
    const rendered = render(<StrictMode><SessionProbe /></StrictMode>);
    expect(await screen.findByText("ready:0")).toBeInTheDocument();
    expect(MOCKS.create).toHaveBeenCalledOnce();

    rendered.unmount();
  });
});
