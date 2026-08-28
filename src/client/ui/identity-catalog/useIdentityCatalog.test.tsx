/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { Result } from "better-result";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityCatalog } from "../../logic/local-identity/localIdentityModels";
import { useIdentityCatalog } from "./useIdentityCatalog";

const MOCKS = vi.hoisted(() => ({
  catalog: { activePublicKeyZ32: null, identities: [] } as LocalIdentityCatalog,
  create: vi.fn(),
  listener: undefined as (() => void) | undefined,
  unavailable: false,
}));

vi.mock("../../logic/local-identity/LocalIdentityController", () => ({
  LocalIdentityController: class {
    constructor() {
      MOCKS.create();
      return {
        createPubkyRingMigration: () => Result.err({ code: "invalid_identity" as const }),
        createRecoveryFile: async () => Result.err({ code: "identity_unavailable" as const }),
        listIdentities: () =>
          MOCKS.unavailable
            ? Result.err({ code: "storage_unavailable" as const })
            : Result.ok(MOCKS.catalog),
        removeIdentity: () => Result.ok(),
        resolveHomeserver: async () => Result.ok(null),
        selectIdentity: () => Result.ok(),
        subscribeToIdentityChanges: (listener: () => void) => {
          MOCKS.listener = listener;
          return () => {
            MOCKS.listener = undefined;
          };
        },
      };
    }
  },
}));

function IdentityCatalogProbe() {
  const state = useIdentityCatalog();
  return (
    <p>{state.status === "ready" ? `ready:${state.catalog.identities.length}` : state.status}</p>
  );
}

describe("useIdentityCatalog", () => {
  beforeEach(() => {
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    MOCKS.unavailable = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("updates when the repository reports same-tab or cross-tab changes", async () => {
    render(<IdentityCatalogProbe />);
    expect(await screen.findByText("ready:0")).toBeInTheDocument();

    MOCKS.catalog = {
      activePublicKeyZ32: "identity",
      identities: [{ publicIdentity: { publicKeyZ32: "identity" } }],
    };
    act(() => MOCKS.listener?.());

    expect(await screen.findByText("ready:1")).toBeInTheDocument();
  });

  it("maps catalog failures to unavailable", async () => {
    MOCKS.unavailable = true;
    render(<IdentityCatalogProbe />);
    expect(await screen.findByText("unavailable")).toBeInTheDocument();
  });

  it("keeps one live subscription under Strict Mode", async () => {
    render(
      <StrictMode>
        <IdentityCatalogProbe />
      </StrictMode>,
    );
    expect(await screen.findByText("ready:0")).toBeInTheDocument();
    expect(MOCKS.listener).toEqual(expect.any(Function));
  });
});
