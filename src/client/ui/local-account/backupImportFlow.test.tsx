/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BackupImportErrorCode } from "@/client/logic/backup/BackupImporter";
import { MAXIMUM_BACKUP_PASSWORD_LENGTH } from "@/client/logic/backup/BackupVerifier";
import { BackupImportFlow } from "./backupImportFlow";

const PUBLIC_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";
const PASSWORD = "correct horse battery";
const IDENTITY = { publicIdentity: { publicKeyZ32: PUBLIC_KEY } };

function backupFile(size = 3) {
  return new File([new Uint8Array(size).fill(7)], "pubky.pkarr", {
    type: "application/octet-stream",
  });
}

function renderFlow(importBackup: (...args: unknown[]) => unknown, republishHomeserver = vi.fn()) {
  const importer = {
    importBackup: vi.fn(importBackup),
    republishHomeserver,
    discardPending: vi.fn(),
    dispose: vi.fn(),
  };
  const onBack = vi.fn();
  const onComplete = vi.fn();
  const rendered = render(
    <BackupImportFlow
      defaultHomeserver={HOMESERVER}
      onBack={onBack}
      onComplete={onComplete}
      createImporter={() => importer as never}
    />,
  );
  return { importer, onBack, onComplete, rendered };
}

async function submitBackup(user: ReturnType<typeof userEvent.setup>, password = PASSWORD) {
  await user.upload(screen.getByLabelText("Pubky backup"), backupFile());
  await user.type(screen.getByLabelText("Backup password"), password);
  await user.click(screen.getByRole("button", { name: "Import backup" }));
}

describe("BackupImportFlow", () => {
  afterEach(cleanup);

  it("imports a backup, hands the identity to the parent, and releases the importer", async () => {
    const { importer, onComplete, rendered } = renderFlow(async () =>
      Result.ok({ status: "imported", identity: IDENTITY }),
    );
    const user = userEvent.setup();
    const password = screen.getByLabelText("Backup password");
    expect(password).toHaveAttribute("maxlength", String(MAXIMUM_BACKUP_PASSWORD_LENGTH));
    expect(password).not.toHaveAttribute("minlength");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "Import backup" })).toBeDisabled();
    await submitBackup(user);
    expect(importer.importBackup).toHaveBeenCalledWith(
      new Uint8Array([7, 7, 7]),
      PASSWORD,
      HOMESERVER,
    );
    expect(onComplete).toHaveBeenCalledWith(IDENTITY);
    expect(password).toHaveValue("");
    rendered.unmount();
    expect(importer.dispose).toHaveBeenCalledOnce();
  });

  it("waits for an importer that is still loading the SDK when the form is sent", async () => {
    let finishLoading!: () => void;
    const importer = {
      importBackup: vi.fn(async () => Result.ok({ status: "imported", identity: IDENTITY })),
      republishHomeserver: vi.fn(),
      discardPending: vi.fn(),
      dispose: vi.fn(),
    };
    const onComplete = vi.fn();
    const rendered = render(
      <BackupImportFlow
        defaultHomeserver={HOMESERVER}
        onBack={vi.fn()}
        onComplete={onComplete}
        createImporter={() =>
          new Promise((resolve) => {
            finishLoading = () => resolve(importer as never);
          })
        }
      />,
    );
    const user = userEvent.setup();
    await submitBackup(user);
    expect(importer.importBackup).not.toHaveBeenCalled();

    finishLoading();
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY));
    rendered.unmount();
    expect(importer.dispose).toHaveBeenCalledOnce();
  });

  it("disposes an importer that finishes loading after the screen closed", async () => {
    let finishLoading!: () => void;
    const importer = { importBackup: vi.fn(), discardPending: vi.fn(), dispose: vi.fn() };
    const rendered = render(
      <BackupImportFlow
        defaultHomeserver={HOMESERVER}
        onBack={vi.fn()}
        onComplete={vi.fn()}
        createImporter={() =>
          new Promise((resolve) => {
            finishLoading = () => resolve(importer as never);
          })
        }
      />,
    );
    await vi.waitFor(() => expect(finishLoading).toBeTypeOf("function"));
    rendered.unmount();
    finishLoading();
    await vi.waitFor(() => expect(importer.dispose).toHaveBeenCalledOnce());
  });

  it("opens backups made elsewhere with a short passphrase", async () => {
    const { importer } = renderFlow(async () =>
      Result.ok({ status: "imported", identity: IDENTITY }),
    );
    await submitBackup(userEvent.setup(), "pin");
    expect(importer.importBackup).toHaveBeenCalledWith(expect.any(Uint8Array), "pin", HOMESERVER);
  });

  it("associates the file-size error with the file input", async () => {
    const { importer } = renderFlow(async () => Result.ok({}));
    const user = userEvent.setup();
    const file = screen.getByLabelText("Pubky backup");
    await user.upload(file, backupFile(1024 * 1024 + 1));
    await user.type(screen.getByLabelText("Backup password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Import backup" }));
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("smaller than 1 MB");
    expect(file).toHaveAttribute("aria-invalid", "true");
    expect(file).toHaveAttribute("aria-describedby", error.id);
    expect(importer.importBackup).not.toHaveBeenCalled();
  });

  it("associates a missing password with the password input", async () => {
    const { importer } = renderFlow(async () => Result.ok({}));
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Pubky backup"), backupFile());
    await user.click(screen.getByRole("button", { name: "Import backup" }));
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Enter the password");
    expect(screen.getByLabelText("Backup password")).toHaveAttribute("aria-describedby", error.id);
    expect(importer.importBackup).not.toHaveBeenCalled();
  });

  it.each([
    ["already_present", "form", /already saved in this browser/u],
    ["external_key", "form", /linked to Pubky Ring/u],
    ["backup_decryption_failed", "password", /password is wrong/u],
    ["invalid_password", "password", /Enter the password/u],
    ["invalid_backup", "file", /valid \.pkarr backup/u],
    ["signin_failed", "form", /account could not be verified/u],
    ["resolution_failed", "form", /could not look up its homeserver record/u],
    ["storage_failed", "form", /could not save it/u],
    ["import_unavailable", "form", /could not import this backup/u],
  ] as const satisfies ReadonlyArray<readonly [BackupImportErrorCode, string, RegExp]>)(
    "explains the %s outcome next to the %s and moves focus there",
    async (code, target, message) => {
      const { onComplete } = renderFlow(async () => Result.err({ code }));
      await submitBackup(userEvent.setup());
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(message);
      const field =
        target === "file"
          ? screen.getByLabelText("Pubky backup")
          : target === "password"
            ? screen.getByLabelText("Backup password")
            : undefined;
      if (field) expect(field).toHaveAttribute("aria-describedby", alert.id);
      // The emptied password would otherwise leave focus on the page, not on what to fix.
      expect(field ?? alert).toHaveFocus();
      expect(onComplete).not.toHaveBeenCalled();
    },
  );

  it("publishes the shown homeserver only after confirmation when the record is missing", async () => {
    const republishHomeserver = vi
      .fn()
      .mockResolvedValueOnce(Result.err({ code: "publish_failed" }))
      .mockResolvedValueOnce(Result.ok(IDENTITY));
    const { onComplete } = renderFlow(
      async () =>
        Result.ok({
          status: "homeserver_record_missing",
          publicIdentity: { publicKeyZ32: PUBLIC_KEY },
        }),
      republishHomeserver,
    );
    const user = userEvent.setup();
    await submitBackup(user);

    expect(
      await screen.findByRole("heading", { name: "Homeserver record missing." }),
    ).toBeInTheDocument();
    expect(screen.getByText(`Pubky: ${PUBLIC_KEY}`)).toBeInTheDocument();
    const publish = screen.getByRole("button", { name: "Publish record and import" });
    // The button names the homeserver it publishes and the caution that goes with it.
    expect(publish).toHaveAccessibleDescription(
      expect.stringContaining(`Homeserver to publish ${HOMESERVER}`),
    );
    expect(publish).toHaveAccessibleDescription(
      expect.stringContaining("Only continue if your account was created on this homeserver."),
    );
    expect(
      screen.getByText(/Only continue if your account was created/u).closest("[data-tone]"),
    ).toHaveAttribute("data-tone", "warning");
    expect(republishHomeserver).not.toHaveBeenCalled();

    await user.click(publish);
    expect(await screen.findByRole("alert")).toHaveTextContent("could not publish");
    await user.click(screen.getByRole("button", { name: "Publish record and import" }));
    expect(republishHomeserver).toHaveBeenLastCalledWith(HOMESERVER);
    expect(onComplete).toHaveBeenCalledWith(IDENTITY);
  });

  it("returns to the import form when a record for another homeserver came back", async () => {
    const republishHomeserver = vi
      .fn()
      .mockResolvedValueOnce(Result.err({ code: "homeserver_record_found" }));
    const { onComplete } = renderFlow(
      async () =>
        Result.ok({
          status: "homeserver_record_missing",
          publicIdentity: { publicKeyZ32: PUBLIC_KEY },
        }),
      republishHomeserver,
    );
    const user = userEvent.setup();
    await submitBackup(user);
    await user.click(await screen.findByRole("button", { name: "Publish record and import" }));

    expect(await screen.findByRole("heading", { name: "Import backup." })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Passport published nothing/u);
    expect(screen.getByRole("button", { name: "Import backup" })).toBeDisabled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("releases the waiting key when the person goes back from the homeserver step", async () => {
    const { importer, onBack } = renderFlow(async () =>
      Result.ok({
        status: "homeserver_record_missing",
        publicIdentity: { publicKeyZ32: PUBLIC_KEY },
      }),
    );
    const user = userEvent.setup();
    await submitBackup(user);
    await user.click(await screen.findByRole("button", { name: "Back" }));
    expect(importer.discardPending).toHaveBeenCalledOnce();
    expect(importer.republishHomeserver).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Import backup." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import backup" })).toBeDisabled();
    expect(onBack).not.toHaveBeenCalled();
  });
});
