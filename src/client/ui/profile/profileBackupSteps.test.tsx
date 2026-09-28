/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdentityCatalogActions } from "@/client/ui/identity-catalog/useIdentityCatalog";
import { ProfileBackupSteps } from "./profileBackupSteps";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const actions = { createRecoveryFile: vi.fn() } as unknown as IdentityCatalogActions;
afterEach(cleanup);

describe("ProfileBackupSteps", () => {
  it("offers backup methods for a browser-held key and leaves in either direction", async () => {
    const onBack = vi.fn();
    const onContinue = vi.fn();
    render(
      <ProfileBackupSteps
        identity={{ publicIdentity: { publicKeyZ32: KEY } }}
        actions={actions}
        onBack={onBack}
        onContinue={onContinue}
      />,
    );
    const user = userEvent.setup();
    expect(screen.getByRole("heading", { name: "Choose backup method" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to profile" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("returns from the encrypted file download to the backup methods", async () => {
    render(
      <ProfileBackupSteps
        identity={{ publicIdentity: { publicKeyZ32: KEY } }}
        actions={actions}
        onBack={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Download backup" }));
    expect(screen.queryByRole("heading", { name: "Choose backup method" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Choose backup method" })).toBeInTheDocument();
  });

  it("points a Ring-held key to Ring instead of offering an export", () => {
    render(
      <ProfileBackupSteps
        identity={{ publicIdentity: { publicKeyZ32: KEY }, keySource: "ring" }}
        actions={actions}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        footer={<p>Footer</p>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Your key is in Ring" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download backup" })).not.toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });
});
