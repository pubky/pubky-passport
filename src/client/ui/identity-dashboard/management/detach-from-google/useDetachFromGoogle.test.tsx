/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockGoogleIdentityFlow } from "../../../../../../test-utils/fakes/mockGoogleIdentityFlow";
import { useDetachFromGoogle } from "./useDetachFromGoogle";

const MOCKS = vi.hoisted(() => ({
  constructGoogleIdentityFlow: vi.fn(),
  detachIdentity: vi.fn(),
}));

vi.mock("../../../../logic/google-identity/GoogleIdentityFlow", () => ({
  GoogleIdentityFlow: function GoogleIdentityFlow(configuration: unknown, onState: unknown) {
    return MOCKS.constructGoogleIdentityFlow(configuration, onState);
  },
}));

function Probe() {
  const operation = useDetachFromGoogle(
    {
      googleClientId: "google-client-id",
      homegateBaseUrl: "https://homegate.example/",
    },
    { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" },
    "google-account",
  );
  return (
    <>
      <p>{operation.state.name}</p>
      <button onClick={operation.detach} type="button">Detach</button>
      <button onClick={operation.retryDetachment} type="button">Retry</button>
    </>
  );
}

describe("useDetachFromGoogle", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reruns detachment after Google authorization fails", async () => {
    MOCKS.detachIdentity
      .mockResolvedValueOnce(Result.err({ code: "authorization_failed" as const }))
      .mockResolvedValueOnce(Result.ok({ deletionStatus: "deleted" as const }));
    MOCKS.constructGoogleIdentityFlow.mockReturnValue(mockGoogleIdentityFlow({
      detachIdentity: MOCKS.detachIdentity,
    }));
    render(<Probe />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Detach" }));
    expect(await screen.findByText("authorization-failed")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("complete")).toBeInTheDocument();
    expect(MOCKS.detachIdentity).toHaveBeenCalledTimes(2);
  });
});
