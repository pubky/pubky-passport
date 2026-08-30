/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withGoogleIdentityConfiguration } from "../../../../../../test-utils/googleIdentityConfiguration";
import { mockGoogleIdentityController } from "../../../../../../test-utils/mockGoogleIdentityController";
import { LOGGER } from "../../../../../libs/logger/logger";
import { useDetachFromGoogle } from "./useDetachFromGoogle";

const MOCKS = vi.hoisted(() => ({
  constructGoogleIdentityController: vi.fn(),
  detachIdentity: vi.fn(),
}));

vi.mock("../../../../logic/google-identity/GoogleIdentityController", () => ({
  GoogleIdentityController: class {
    constructor(googleClientId: string, homegateBaseUrl: string, onState: unknown) {
      return MOCKS.constructGoogleIdentityController(googleClientId, homegateBaseUrl, onState);
    }
  },
}));

function Probe() {
  const operation = useDetachFromGoogle({ publicKeyZ32: "identity" }, "google-account");
  return (
    <>
      <p>
        {operation.state.status === "operation-failed"
          ? operation.state.error.code
          : operation.state.status}
      </p>
      <output data-testid="operation-state">{JSON.stringify(operation.state)}</output>
      <button onClick={operation.detach} type="button">
        Detach
      </button>
      <button onClick={operation.retryDetachment} type="button">
        Retry
      </button>
    </>
  );
}

function renderProbe() {
  return render(withGoogleIdentityConfiguration(<Probe />));
}

describe("useDetachFromGoogle", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reruns detachment after Google authorization fails", async () => {
    MOCKS.detachIdentity
      .mockResolvedValueOnce(Result.err({ code: "authorization_failed" as const }))
      .mockResolvedValueOnce(Result.ok());
    MOCKS.constructGoogleIdentityController.mockReturnValue(
      mockGoogleIdentityController({
        detachIdentity: MOCKS.detachIdentity,
      }),
    );
    renderProbe();

    await userEvent.setup().click(screen.getByRole("button", { name: "Detach" }));
    expect(await screen.findByText("authorization-failed")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("complete")).toBeInTheDocument();
    expect(MOCKS.detachIdentity).toHaveBeenCalledTimes(2);
  });

  it("shows operation failures returned by the controller", async () => {
    MOCKS.detachIdentity.mockResolvedValue(
      Result.err({
        code: "google_drive_cleanup_failed" as const,
      }),
    );
    MOCKS.constructGoogleIdentityController.mockReturnValue(
      mockGoogleIdentityController({
        detachIdentity: MOCKS.detachIdentity,
      }),
    );
    renderProbe();

    await userEvent.setup().click(screen.getByRole("button", { name: "Detach" }));

    expect(await screen.findByText("google_drive_cleanup_failed")).toBeInTheDocument();
    expect(screen.getByTestId("operation-state")).toHaveTextContent(
      JSON.stringify({
        status: "operation-failed",
        error: { code: "google_drive_cleanup_failed" },
      }),
    );
  });

  it("contains rejected promise details outside hook state and log arguments", async () => {
    const thrown = { secret: "DETACH-PROMISE-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.detachIdentity.mockRejectedValue(thrown);
    MOCKS.constructGoogleIdentityController.mockReturnValue(
      mockGoogleIdentityController({
        detachIdentity: MOCKS.detachIdentity,
      }),
    );
    renderProbe();

    await userEvent.setup().click(screen.getByRole("button", { name: "Detach" }));

    expect(await screen.findByText("operation_failed")).toBeInTheDocument();
    expect(screen.getByTestId("operation-state")).not.toHaveTextContent("DETACH-PROMISE-CANARY");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("DETACH-PROMISE-CANARY");
  });

  it("contains controller construction details outside hook state", async () => {
    const thrown = { secret: "DETACH-CONSTRUCTOR-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.constructGoogleIdentityController.mockImplementationOnce(() => {
      throw thrown;
    });

    renderProbe();

    await userEvent.setup().click(screen.getByRole("button", { name: "Detach" }));
    expect(await screen.findByText("operation_failed")).toBeInTheDocument();
    expect(screen.getByTestId("operation-state")).not.toHaveTextContent(
      "DETACH-CONSTRUCTOR-CANARY",
    );
    expect(warning).toHaveBeenCalledWith("identity.google.detachment_ui.failed", {
      operation: "construct_controller",
      diagnosticId: expect.any(String),
      errorName: "ErrorLike",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("DETACH-CONSTRUCTOR-CANARY");
  });

  it("retries controller construction on a user retry", async () => {
    MOCKS.constructGoogleIdentityController
      .mockImplementationOnce(() => {
        throw new Error("temporarily unavailable");
      })
      .mockReturnValue(
        mockGoogleIdentityController({
          detachIdentity: vi.fn(async () => Result.ok()),
        }),
      );
    renderProbe();

    await userEvent.setup().click(screen.getByRole("button", { name: "Detach" }));
    expect(await screen.findByText("operation_failed")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("complete")).toBeInTheDocument();
    expect(MOCKS.constructGoogleIdentityController).toHaveBeenCalledTimes(2);
  });
});
