/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import type {
  BrowserIdentityController,
  BrowserIdentityList,
  GoogleBackedIdentityActionResult,
} from "../browser/identity/browserIdentityController";
import { mockBrowserIdentityController } from "../../test-utils/fakes/mockBrowserIdentityController";
import { DevelopmentIdentityPanel } from "./developmentIdentityPanel";

const FLOW_STATE = vi.hoisted(() => ({
  establish: async (): Promise<GoogleBackedIdentityActionResult> => { throw new Error("establish result not configured"); },
  deleteExpectedPublicKey: null as string | null,
  refresh: null as (() => void) | null,
  setCatalog: null as ((catalog: BrowserIdentityList) => void) | null,
  controller: null as unknown,
}));

vi.mock("../browser/identity/createBrowserIdentityController", () => ({
  createBrowserIdentityController: () => FLOW_STATE.controller,
}));

vi.mock("./googleBackedIdentityActionPanel", () => ({
  GoogleBackedIdentityActionPanel: ({ action, controller, onActionCompleted }: {
    action: { kind: "establish_google_backed_identity" } | { kind: "delete_google_drive_passport_file"; expectedPublicKeyZ32: string };
    controller: { continueGoogleBackedIdentityAction(action: unknown): Promise<{ status: string; result?: unknown }> };
    onActionCompleted: (result: unknown) => void;
  }) => <button onClick={() => void controller.continueGoogleBackedIdentityAction(action).then((completed) => {
    if (completed.status === "action_completed") onActionCompleted(completed.result);
  })} type="button">Authorize test Google</button>,
}));

const SELECTED_CATALOG: BrowserIdentityList = {
  activeIdentityId: "selected-identity",
  identities: [{
    id: "selected-identity",
    publicIdentity: { publicKeyZ32: "selected-identity", publicKeyDisplay: "pubkyselected-identity" },
  }],
};

describe("DevelopmentIdentityPanel", () => {
  beforeEach(() => {
    FLOW_STATE.establish = async () => { throw new Error("establish result not configured"); };
    FLOW_STATE.deleteExpectedPublicKey = null;
    FLOW_STATE.refresh = null;
    FLOW_STATE.setCatalog = null;
    FLOW_STATE.controller = controllerWithCatalog();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the identity dropdown but hides destructive tools outside development", async () => {
    FLOW_STATE.controller = controllerWithCatalog(SELECTED_CATALOG);
    render(<DevelopmentIdentityPanel allowGoogleDrivePassportFileDeletion={false} googleClientId="google-client" homegateBaseUrl={HOMEGATE_BASE_URL} />);

    expect(screen.getByRole("combobox", { name: "Selected Pubky identity" }).getAttribute("autocomplete")).toBe("off");
    expect(await screen.findByRole("option", { name: "pubkyselected-identity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Pubky identity" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Google Drive Passport file" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear local Pubky identities" })).not.toBeInTheDocument();
  });

  it("shows selected-identity deletion and local clear in development", async () => {
    FLOW_STATE.controller = controllerWithCatalog(SELECTED_CATALOG);
    render(<DevelopmentIdentityPanel allowGoogleDrivePassportFileDeletion googleClientId="google-client" homegateBaseUrl={HOMEGATE_BASE_URL} />);

    expect(await screen.findByRole("button", { name: "Delete Google Drive Passport file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear local Pubky identities" })).toBeInTheDocument();
  });

  it("keeps failed and selected Drive deletion as separate exact targets", async () => {
    FLOW_STATE.controller = controllerWithCatalog(SELECTED_CATALOG);
    FLOW_STATE.establish = async () => Result.err({
      code: "signup_failed",
      partialSetupPublicIdentity: {
        publicKeyZ32: "failed-drive-identity",
        publicKeyDisplay: "pubkyfailed-drive-identity",
      },
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<DevelopmentIdentityPanel allowGoogleDrivePassportFileDeletion googleClientId="google-client" homegateBaseUrl={HOMEGATE_BASE_URL} />);

    expect(await screen.findByRole("button", { name: "Add Pubky identity" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Pubky identity" }));
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    expect(await screen.findByRole("button", { name: "Delete partial setup Passport file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Google Drive Passport file" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete partial setup Passport file" }));
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    await waitFor(() => expect(FLOW_STATE.deleteExpectedPublicKey).toBe("failed-drive-identity"));
  });

  it("keeps the confirmed Drive deletion target across external catalog refreshes", async () => {
    FLOW_STATE.controller = controllerWithCatalog(SELECTED_CATALOG);
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<DevelopmentIdentityPanel allowGoogleDrivePassportFileDeletion googleClientId="google-client" homegateBaseUrl={HOMEGATE_BASE_URL} />);
    expect(await screen.findByRole("button", { name: "Delete Google Drive Passport file" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Google Drive Passport file" }));
    FLOW_STATE.setCatalog?.({
      activeIdentityId: "other-identity",
      identities: [{
        id: "other-identity",
        publicIdentity: { publicKeyZ32: "other-identity", publicKeyDisplay: "pubkyother-identity" },
      }],
    });
    act(() => FLOW_STATE.refresh?.());
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    await waitFor(() => expect(FLOW_STATE.deleteExpectedPublicKey).toBe("selected-identity"));
  });

  it("does not offer Drive cleanup when invitation retrieval fails before creation", async () => {
    FLOW_STATE.establish = async () => Result.err({ code: "homegate_unavailable" });
    render(<DevelopmentIdentityPanel allowGoogleDrivePassportFileDeletion googleClientId="google-client" homegateBaseUrl={HOMEGATE_BASE_URL} />);

    expect(await screen.findByRole("button", { name: "Add Pubky identity" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Pubky identity" }));
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    expect(await screen.findByText(/Passport did not create a Pubky identity/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete partial setup Passport file" })).not.toBeInTheDocument();
  });

  it("preserves a restored Passport file without offering partial-setup deletion", async () => {
    FLOW_STATE.establish = async () => Result.err({ code: "signin_failed" });
    render(<DevelopmentIdentityPanel allowGoogleDrivePassportFileDeletion googleClientId="google-client" homegateBaseUrl={HOMEGATE_BASE_URL} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add Pubky identity" }));
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    expect(await screen.findByText(/encrypted Google Drive Passport file was preserved/)).toBeInTheDocument();
    expect(screen.getByText(/Choose Add Pubky identity to retry activation/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete partial setup Passport file" })).not.toBeInTheDocument();
  });
});

const HOMEGATE_BASE_URL = "https://homegate.example/";

function controllerWithCatalog(
  initialCatalog: BrowserIdentityList = { activeIdentityId: null, identities: [] },
): BrowserIdentityController {
  let catalog = initialCatalog;
  FLOW_STATE.setCatalog = (nextCatalog) => { catalog = nextCatalog; };

  return mockBrowserIdentityController({
    list: () => Result.ok(catalog),
    select: (id: string) => {
      catalog = {
        activeIdentityId: id,
        identities: catalog.identities,
      };
      return Result.ok();
    },
    clear: () => {
      catalog = { activeIdentityId: null, identities: [] };
      return Result.ok();
    },
    subscribe: (listener: () => void) => {
      FLOW_STATE.refresh = listener;
      return () => { FLOW_STATE.refresh = null; };
    },
    continueGoogleBackedIdentityAction: async (action: { kind: "establish_google_backed_identity" } | { kind: "delete_google_drive_passport_file"; expectedPublicKeyZ32: string }) => {
      if (action.kind === "establish_google_backed_identity") {
        return { status: "action_completed", result: await FLOW_STATE.establish() };
      }
      FLOW_STATE.deleteExpectedPublicKey = action.expectedPublicKeyZ32;
      return { status: "action_completed", result: Result.ok({ kind: "google_drive_passport_file_deleted" }) };
    },
  });
}
