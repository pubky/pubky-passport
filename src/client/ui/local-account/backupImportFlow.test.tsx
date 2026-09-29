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

function renderFlow(
  importBackup: (...args: unknown[]) => unknown,
  republishHomeserver = vi.fn(),
  onSelectExisting?: (publicKeyZ32: string) => void,
) {
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
      onSelectExisting={onSelectExisting}
      createImporter={() => importer as never}
    />,
  );
  return { importer, onBack, onComplete, rendered };
}

async function submitBackup(user: ReturnType<typeof userEvent.setup>, password = PASSWORD) {
  await user.upload(screen.getByLabelText("Recovery file"), backupFile());
  await user.type(screen.getByLabelText("Recovery file password"), password);
  await user.click(screen.getByRole("button", { name: "Import recovery file" }));
}

describe("BackupImportFlow", () => {
  afterEach(cleanup);

  it("imports a backup, hands the identity to the parent, and releases the importer", async () => {
    const { importer, onComplete, rendered } = renderFlow(async () =>
      Result.ok({ status: "imported", identity: IDENTITY }),
    );
    const user = userEvent.setup();
    const password = screen.getByLabelText("Recovery file password");
    expect(password).toHaveAttribute("maxlength", String(MAXIMUM_BACKUP_PASSWORD_LENGTH));
    expect(password).not.toHaveAttribute("minlength");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    // Pressed early, the import says what is missing instead of doing nothing.
    expect(screen.getByRole("button", { name: "Import recovery file" })).toBeEnabled();
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
    const file = screen.getByLabelText("Recovery file");
    await user.upload(file, backupFile(1024 * 1024 + 1));
    await user.type(screen.getByLabelText("Recovery file password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Import recovery file" }));
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("smaller than 1 MB");
    expect(file).toHaveAttribute("aria-invalid", "true");
    expect(file).toHaveAttribute("aria-describedby", error.id);
    expect(importer.importBackup).not.toHaveBeenCalled();
  });

  it("associates a missing password with the password input", async () => {
    const { importer } = renderFlow(async () => Result.ok({}));
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Recovery file"), backupFile());
    await user.click(screen.getByRole("button", { name: "Import recovery file" }));
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Enter the password");
    expect(screen.getByLabelText("Recovery file password")).toHaveAttribute(
      "aria-describedby",
      error.id,
    );
    expect(importer.importBackup).not.toHaveBeenCalled();
  });

  it.each([
    ["already_present", "form", /already saved in this browser/u],
    ["external_key", "form", /linked to Pubky Ring/u],
    ["backup_decryption_failed", "password", /doesn’t open this recovery file.*check for typos/u],
    ["invalid_password", "password", /Enter the password/u],
    [
      "invalid_backup",
      "file",
      /^This isn’t a recovery file\. Choose the file whose name ends in \.pkarr\.$/u,
    ],
    ["signin_failed", "form", /couldn’t sign in to its account.+Check your connection/u],
    ["resolution_failed", "form", /couldn’t look up which homeserver holds its account/u],
    ["storage_failed", "form", /couldn’t save the identity\. Allow site data/u],
    ["import_unavailable", "form", /could not import this recovery file/u],
  ] as const satisfies ReadonlyArray<readonly [BackupImportErrorCode, string, RegExp]>)(
    "explains the %s outcome next to the %s and moves focus there",
    async (code, target, message) => {
      const { onComplete } = renderFlow(async () => Result.err({ code }));
      await submitBackup(userEvent.setup());
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(message);
      const field =
        target === "file"
          ? screen.getByLabelText("Recovery file")
          : target === "password"
            ? screen.getByLabelText("Recovery file password")
            : undefined;
      if (field) expect(field).toHaveAttribute("aria-describedby", alert.id);
      // The emptied password would otherwise leave focus on the page, not on what to fix.
      expect(field ?? alert).toHaveFocus();
      expect(onComplete).not.toHaveBeenCalled();
    },
  );

  it("shows and hides the password", async () => {
    renderFlow(async () => Result.ok({}));
    const user = userEvent.setup();
    const password = screen.getByLabelText("Recovery file password");
    const reveal = screen.getByRole("button", { name: "Show password" });
    expect(reveal).toHaveAttribute("aria-controls", password.id);
    await user.click(reveal);
    expect(password).toHaveAttribute("type", "text");
    expect(reveal).toHaveAttribute("aria-pressed", "true");
    await user.click(reveal);
    expect(password).toHaveAttribute("type", "password");
  });

  it("offers the saved identity when the backup is of one this browser already holds", async () => {
    const onSelectExisting = vi.fn();
    const { onComplete } = renderFlow(
      async () => Result.err({ code: "already_present", publicKeyZ32: PUBLIC_KEY }),
      vi.fn(),
      onSelectExisting,
    );
    const user = userEvent.setup();
    await submitBackup(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("already saved in this browser");
    await user.click(screen.getByRole("button", { name: "Use this identity" }));
    expect(onSelectExisting).toHaveBeenCalledExactlyOnceWith(PUBLIC_KEY);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each(["signin_failed", "resolution_failed"] as const)(
    "keeps the password after %s so Try again sends the same backup again",
    async (code) => {
      const importBackup = vi
        .fn()
        .mockResolvedValueOnce(Result.err({ code }))
        .mockResolvedValueOnce(Result.ok({ status: "imported", identity: IDENTITY }));
      const { onComplete } = renderFlow(importBackup);
      const user = userEvent.setup();
      await submitBackup(user);
      await screen.findByRole("alert");
      expect(screen.getByLabelText("Recovery file password")).toHaveValue(PASSWORD);
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(importBackup).toHaveBeenCalledTimes(2);
      expect(importBackup).toHaveBeenLastCalledWith(expect.any(Uint8Array), PASSWORD, HOMESERVER);
      expect(onComplete).toHaveBeenCalledWith(IDENTITY);
    },
  );

  it("keeps the message and focus on Try again while the retry runs", async () => {
    let answer!: (result: unknown) => void;
    const importBackup = vi
      .fn()
      .mockResolvedValueOnce(Result.err({ code: "signin_failed" }))
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    renderFlow(importBackup);
    const user = userEvent.setup();
    await submitBackup(user);
    await screen.findByRole("alert");
    const retry = screen.getByRole("button", { name: "Try again" });
    await user.click(retry);

    // Unmounting the message would drop focus to the page while the retry runs.
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute("aria-busy", "true");
    answer(Result.err({ code: "signin_failed" }));
    await vi.waitFor(() => expect(retry).not.toHaveAttribute("aria-busy"));
    expect(retry).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Check your connection and try again.");
  });

  it("offers no retry where sending the same password again cannot help", async () => {
    renderFlow(async () => Result.err({ code: "storage_failed" }));
    await submitBackup(userEvent.setup());
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Recovery file password")).toHaveValue("");
  });

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
      await screen.findByRole("heading", { name: "Homeserver not found." }),
    ).toBeInTheDocument();
    // Plain language first; the keys wait behind Technical details.
    expect(screen.getByText("This Passport’s homeserver")).toBeInTheDocument();
    const details = screen.getByText("Technical details").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    await user.click(screen.getByText("Technical details"));
    expect(details).toHaveAttribute("open");
    expect(details).toHaveTextContent(PUBLIC_KEY);
    expect(details).toHaveTextContent(HOMESERVER);
    expect(screen.getByRole("button", { name: "Copy Your pubky" })).toBeEnabled();
    const publish = screen.getByRole("button", { name: "Reconnect and import" });
    // The button names what it lists and the caution that goes with it.
    expect(publish).toHaveAccessibleDescription(
      expect.stringContaining("Homeserver to list This Passport’s homeserver"),
    );
    // The question is where the account lives: one made here may use a homeserver entered then.
    expect(publish).toHaveAccessibleDescription(
      expect.stringContaining(
        "Continue only if you signed up here without entering a different homeserver.",
      ),
    );
    expect(
      screen.getByText(/without entering a different homeserver/u).closest("[data-tone]"),
    ).toHaveAttribute("data-tone", "warning");
    expect(republishHomeserver).not.toHaveBeenCalled();

    await user.click(publish);
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn’t list the homeserver");
    await user.click(screen.getByRole("button", { name: "Reconnect and import" }));
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
    await user.click(await screen.findByRole("button", { name: "Reconnect and import" }));

    expect(
      await screen.findByRole("heading", { name: "Import recovery file." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Passport changed nothing/u);
    // This browser cannot put the file back into the picker, so the message asks for it too.
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Choose the file and enter its password again/u,
    );
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
    expect(screen.getByRole("heading", { name: "Import recovery file." })).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });
});
