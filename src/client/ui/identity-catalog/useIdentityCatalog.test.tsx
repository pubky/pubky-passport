/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeLocalIdentityController } from "@test-utils/fakeLocalIdentityController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import { useIdentityCatalog } from "./useIdentityCatalog";

const CATALOG: {
  catalog: LocalIdentityCatalog | undefined;
  listener: (() => void) | undefined;
  storageUnavailable: boolean;
} = {
  catalog: { activePublicKeyZ32: null, identities: [] },
  listener: undefined,
  storageUnavailable: false,
};
const create = vi.fn();

function IdentityCatalogProbe() {
  const state = useIdentityCatalog();
  return (
    <p>{state.status === "ready" ? `ready:${state.catalog.identities.length}` : state.status}</p>
  );
}

function renderProbe(children = <IdentityCatalogProbe />) {
  return render(
    withPassportTestProviders(children, {
      createLocalIdentityController: () => {
        create();
        return fakeLocalIdentityController(CATALOG);
      },
    }),
  );
}

describe("useIdentityCatalog", () => {
  beforeEach(() => {
    CATALOG.catalog = { activePublicKeyZ32: null, identities: [] };
    CATALOG.listener = undefined;
    CATALOG.storageUnavailable = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("updates when the repository reports same-tab or cross-tab changes", async () => {
    renderProbe();
    expect(await screen.findByText("ready:0")).toBeInTheDocument();

    CATALOG.catalog = {
      activePublicKeyZ32: "identity",
      identities: [{ publicIdentity: { publicKeyZ32: "identity" } }],
    };
    act(() => CATALOG.listener?.());

    expect(await screen.findByText("ready:1")).toBeInTheDocument();
  });

  it("maps catalog failures to unavailable", async () => {
    CATALOG.storageUnavailable = true;
    renderProbe();
    expect(await screen.findByText("unavailable")).toBeInTheDocument();
  });

  it("keeps one live subscription under Strict Mode", async () => {
    renderProbe(
      <StrictMode>
        <IdentityCatalogProbe />
      </StrictMode>,
    );
    expect(await screen.findByText("ready:0")).toBeInTheDocument();
    expect(CATALOG.listener).toEqual(expect.any(Function));
  });
});
