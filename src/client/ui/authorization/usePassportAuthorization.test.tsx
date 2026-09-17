/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PassportAuthorizationController } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { usePassportAuthorization } from "./usePassportAuthorization";

function Probe() {
  const { controller, state } = usePassportAuthorization();
  return (
    <p>
      {state?.status ?? "no-state"}:
      {controller === PassportAuthorizationController.fromBrowser() ? "browser" : "other"}
    </p>
  );
}

describe("usePassportAuthorization", () => {
  afterEach(cleanup);

  it("uses the page-scoped browser controller when no collaborators provider is rendered", async () => {
    render(<Probe />);

    expect(await screen.findByText("manual-entry:browser")).toBeInTheDocument();
  });
});
