/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityCatalog } from "../../logic/local-identity/localIdentityModels";
import { useIdentityCatalog } from "./useIdentityCatalog";

const MOCKS = vi.hoisted(() => ({
  catalog: { activePublicKeyZ32: null, identities: [] } as LocalIdentityCatalog,
  create: vi.fn(),
  loadError: undefined as unknown,
  unavailable: false,
}));

vi.mock("../../logic/local-identity/LocalIdentityController", () => ({
  LocalIdentityController: function LocalIdentityController() {
    MOCKS.create();
    return {
      listIdentities: () => {
        if (MOCKS.loadError !== undefined) throw MOCKS.loadError;
        return MOCKS.unavailable
          ? Result.err({ code: "storage_unavailable" as const })
          : Result.ok(MOCKS.catalog);
      },
    };
  },
}));

function IdentityCatalogProbe() {
  const identityCatalogState = useIdentityCatalog();
  return identityCatalogState.status === "ready"
    ? <><p>{`${identityCatalogState.status}:${identityCatalogState.catalog.identities.length}`}</p><button onClick={identityCatalogState.refreshIdentityCatalog} type="button">Refresh</button></>
    : <p>{identityCatalogState.status}</p>;
}

describe("useIdentityCatalog", () => {
  beforeEach(() => {
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    MOCKS.loadError = undefined;
    MOCKS.unavailable = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reloads the identity catalog explicitly", async () => {
    render(<IdentityCatalogProbe />);
    expect(await screen.findByText("ready:0")).toBeInTheDocument();

    MOCKS.catalog = {
      activePublicKeyZ32: "identity",
      identities: [{ publicIdentity: { publicKeyDisplay: "pubkyidentity", publicKeyZ32: "identity" } }],
    };
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("ready:1")).toBeInTheDocument();
  });

  it("maps catalog failures", async () => {
    MOCKS.unavailable = true;
    render(<IdentityCatalogProbe />);
    expect(await screen.findByText("unavailable")).toBeInTheDocument();
  });

  it("contains thrown load failures outside UI state", async () => {
    const secret = "sensitive catalog detail";
    MOCKS.loadError = new TypeError(secret);

    render(<IdentityCatalogProbe />);

    const state = await screen.findByText("unavailable");
    expect(state).not.toHaveTextContent(secret);
  });

  it("creates one live controller under Strict Mode", async () => {
    const rendered = render(<StrictMode><IdentityCatalogProbe /></StrictMode>);
    expect(await screen.findByText("ready:0")).toBeInTheDocument();
    expect(MOCKS.create).toHaveBeenCalledOnce();

    rendered.unmount();
  });
});
