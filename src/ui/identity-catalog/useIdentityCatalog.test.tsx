/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityCatalog } from "../../browser/identity/passportIdentityController";
import { useIdentityCatalog } from "./useIdentityCatalog";

const MOCKS = vi.hoisted(() => ({
  catalog: { activeIdentityId: null, identities: [] } as LocalIdentityCatalog,
  create: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as (() => void) | null,
  unavailable: false,
}));

vi.mock("../../browser/identity/passportIdentityController", () => ({
  PassportIdentityController: function PassportIdentityController() {
    MOCKS.create();
    return {
    listIdentities: () => MOCKS.unavailable
      ? Result.err({ code: "storage_unavailable" as const })
      : Result.ok(MOCKS.catalog),
    subscribeToIdentityChanges: (listener: () => void) => {
      MOCKS.listener = listener;
      return () => { MOCKS.listener = null; MOCKS.unsubscribe(); };
    },
    };
  },
}));

function SessionProbe() {
  const session = useIdentityCatalog("client", "https://homegate.example/");
  return <p>{session.status === "ready" ? `${session.status}:${session.catalog.identities.length}` : session.status}</p>;
}

describe("useIdentityCatalog", () => {
  beforeEach(() => {
    MOCKS.catalog = { activeIdentityId: null, identities: [] };
    MOCKS.unavailable = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    MOCKS.listener = null;
  });

  it("publishes and refreshes the live identity catalog", async () => {
    render(<SessionProbe />);
    expect(await screen.findByText("ready:0")).toBeInTheDocument();

    MOCKS.catalog = {
      activeIdentityId: "identity",
      identities: [{ id: "identity", publicIdentity: { publicKeyDisplay: "pubkyidentity", publicKeyZ32: "identity" } }],
    };
    MOCKS.listener?.();

    expect(await screen.findByText("ready:1")).toBeInTheDocument();
  });

  it("maps catalog failures and unsubscribes on unmount", async () => {
    MOCKS.unavailable = true;
    const rendered = render(<SessionProbe />);
    expect(await screen.findByText("unavailable")).toBeInTheDocument();

    rendered.unmount();
    await waitFor(() => expect(MOCKS.unsubscribe).toHaveBeenCalledOnce());
  });

  it("creates one live controller under Strict Mode", async () => {
    const rendered = render(<StrictMode><SessionProbe /></StrictMode>);
    expect(await screen.findByText("ready:0")).toBeInTheDocument();
    expect(MOCKS.create).toHaveBeenCalledOnce();

    rendered.unmount();
    await waitFor(() => expect(MOCKS.unsubscribe).toHaveBeenCalledOnce());
  });
});
