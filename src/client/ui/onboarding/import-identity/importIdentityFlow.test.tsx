/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fakeAppleIdentityController,
  TEST_APPLE_CONFIGURATION,
} from "@test-utils/fakeAppleIdentityController";
import { fakeLocalIdentityController } from "@test-utils/fakeLocalIdentityController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import type {
  LocalIdentityImportResult,
  LocalIdentityImportSource,
} from "@/client/logic/local-identity/LocalIdentityController";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { AppleIdentityConfigurationProvider } from "@/client/ui/appleIdentityConfiguration";
import { IdentityEstablishmentFlow } from "../identityEstablishmentFlow";

const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const WORDS = PHRASE.split(" ");
const PUBLIC_KEY = "a53kaica1hg81a3znuj6szbw469h84jpwsg8gifuxgmpujfx8k3y";
const LINK = "Import it";

type ImportIdentity = (
  source: LocalIdentityImportSource,
  onKeyRecovered?: (publicIdentity: PubkyPublicIdentity) => void,
) => Promise<LocalIdentityImportResult>;

function renderFlow({
  apple = null,
  forAuthorization = false,
  importIdentity = vi.fn<ImportIdentity>(async () => Result.err({ code: "import_failed" })),
  onBack,
  onComplete = vi.fn(),
}: {
  apple?: typeof TEST_APPLE_CONFIGURATION | null;
  forAuthorization?: boolean;
  importIdentity?: ImportIdentity;
  onBack?: () => void;
  onComplete?: () => void;
} = {}) {
  const fake = fakeAppleIdentityController();
  const establishIdentity = vi.fn(() => new Promise<never>(() => undefined));
  const view = render(
    withPassportTestProviders(
      <AppleIdentityConfigurationProvider apple={apple}>
        <IdentityEstablishmentFlow
          forAuthorization={forAuthorization}
          onBack={onBack}
          onComplete={onComplete}
        />
      </AppleIdentityConfigurationProvider>,
      {
        createAppleIdentityController: () => fake.controller,
        createGoogleIdentityController: () => mockGoogleIdentityController({ establishIdentity }),
        createLocalIdentityController: () =>
          fakeLocalIdentityController({}, { importIdentity: importIdentity as never }),
      },
    ),
  );
  return { ...view, establishIdentity, importIdentity, onComplete };
}

function precedes(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

async function openPhrase(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: LINK }));
  await user.click(await screen.findByRole("button", { name: /Recovery phrase/u }));
  await screen.findByRole("heading", { name: "Recovery phrase." });
}

async function openFile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: LINK }));
  await user.click(await screen.findByRole("button", { name: /Recovery file/u }));
  await screen.findByRole("heading", { name: "Recovery file." });
}

function wordInputs(): HTMLInputElement[] {
  return WORDS.map((_, index) =>
    screen.getByRole<HTMLInputElement>("textbox", { name: `Word ${index + 1}` }),
  );
}

function paste(input: HTMLElement, text: string) {
  fireEvent.paste(input, { clipboardData: { getData: () => text } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("import link on the provider choice", () => {
  it.each([
    ["start page, Apple off", { apple: null }],
    ["start page, Apple on", { apple: TEST_APPLE_CONFIGURATION }],
    ["Add identity, Apple off", { apple: null, onBack: vi.fn() }],
    ["Add identity, Apple on", { apple: TEST_APPLE_CONFIGURATION, onBack: vi.fn() }],
    [
      "/authorize and Use other identity, Apple on",
      { apple: TEST_APPLE_CONFIGURATION, forAuthorization: true, onBack: vi.fn() },
    ],
  ] as const)(
    "is a one-line text link above the notice and badge (%s)",
    async (_label, options) => {
      renderFlow(options);
      const link = await screen.findByRole("button", { name: LINK });
      expect(screen.getAllByRole("button", { name: LINK })).toHaveLength(1);
      expect(link.parentElement).toHaveTextContent(`Already have a pubky? ${LINK}`);
      expect(link.parentElement!.querySelector("br")).toBeNull();

      // Not a third provider: no pill, no fill, not in the provider group.
      expect(link.className).not.toMatch(/rounded-full|bg-|h-15|border /u);
      expect(link).toHaveClass("underline", "text-brand");
      expect(link.parentElement).toHaveClass("text-sm", "text-muted-foreground");
      const providerGroup = screen.queryByRole("group", {
        name: "Choose an account to sign in with",
      });
      if (providerGroup) expect(providerGroup).not.toContainElement(link);

      // Buttons, then the link, then the notice and badge; Back stays last.
      const notice = document.querySelector("[data-passport-sign-in-notice]")!;
      const badge = screen.getByRole("img", { name: "Synonym, a Tether company" });
      const lastProvider = screen.getAllByRole("button", { name: /^Continue with/u }).at(-1)!;
      expect(precedes(lastProvider, link)).toBe(true);
      expect(precedes(link, notice)).toBe(true);
      expect(notice.nextElementSibling).toBe(badge);
      const back = screen.queryByRole("button", { name: "Back" });
      if (back) expect(precedes(link, back)).toBe(true);
    },
  );

  it("does not appear while /authorize starts Google directly (Apple off)", async () => {
    const { establishIdentity } = renderFlow({ forAuthorization: true, onBack: vi.fn() });
    await vi.waitFor(() => expect(establishIdentity).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: LINK })).toBeNull();
  });

  it("opens the import choice and comes back to the provider choice", async () => {
    const user = userEvent.setup();
    renderFlow({ apple: TEST_APPLE_CONFIGURATION });
    await user.click(screen.getByRole("button", { name: LINK }));

    expect(await screen.findByRole("heading", { name: "Import pubky." })).toBeVisible();
    const choice = screen.getByRole("group", { name: "Import with" });
    expect(
      within(choice)
        .getAllByRole("button")
        .map((button) => button.querySelector("strong")?.textContent),
    ).toEqual(["Recovery phrase", "Recovery file"]);
    const back = screen.getByRole("button", { name: "Back" });
    expect(precedes(choice, back)).toBe(true);

    await user.click(back);
    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeVisible();
  });
});

describe("recovery phrase import", () => {
  it("fills all twelve inputs from one paste with line breaks, from any input", async () => {
    const user = userEvent.setup();
    renderFlow();
    await openPhrase(user);
    const restore = screen.getByRole("button", { name: "Restore" });
    expect(restore).toBeDisabled();

    paste(wordInputs()[5]!, WORDS.map((word) => word.toUpperCase()).join("\n"));

    expect(wordInputs().map((input) => input.value)).toEqual(WORDS);
    expect(restore).toBeEnabled();
  });

  it.each([
    ["dashes", WORDS.join("-")],
    ["spaces typed into one input", WORDS.join(" ")],
  ])("accepts a phrase with %s", async (_label, text) => {
    const user = userEvent.setup();
    renderFlow();
    await openPhrase(user);
    const first = wordInputs()[0]!;
    if (text.includes(" ")) fireEvent.change(first, { target: { value: text } });
    else paste(first, text);
    expect(wordInputs().map((input) => input.value)).toEqual(WORDS);
  });

  it("spreads a partial paste from the input it lands in", async () => {
    const user = userEvent.setup();
    renderFlow();
    await openPhrase(user);
    paste(wordInputs()[2]!, "thank year wave");
    expect(wordInputs().map((input) => input.value)).toEqual([
      "",
      "",
      "thank",
      "year",
      "wave",
      ...Array<string>(7).fill(""),
    ]);
  });

  it("rejects a paste that does not fit twelve words", async () => {
    const user = userEvent.setup();
    renderFlow();
    await openPhrase(user);
    paste(wordInputs()[0]!, [...WORDS, "abandon"].join(" "));
    expect(
      screen.getByText("A recovery phrase has 12 words. Check what you pasted."),
    ).toBeVisible();
    expect(wordInputs().every((input) => input.value === "")).toBe(true);
    paste(wordInputs()[11]!, "legal winner");
    expect(
      screen.getByText("A recovery phrase has 12 words. Check what you pasted."),
    ).toBeVisible();
  });

  it("marks a word outside the wordlist when it loses focus, and moves on after a space", async () => {
    const user = userEvent.setup();
    renderFlow();
    await openPhrase(user);
    const [first, second] = wordInputs();
    await user.type(first!, "pubky ");
    expect(second).toHaveFocus();
    expect(first).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("Invalid words detected. Check the spelling of the marked words."),
    ).toBeVisible();

    await user.clear(first!);
    await user.type(first!, "Legal");
    await user.tab();
    expect(first).toHaveValue("legal");
    expect(first).not.toHaveAttribute("aria-invalid");
  });

  it("keeps the words out of forms, autofill, spellcheck and translation", async () => {
    const user = userEvent.setup();
    const { container } = renderFlow();
    await openPhrase(user);

    expect(container.querySelector("form")).toBeNull();
    expect(screen.getByRole("group", { name: "Recovery phrase" })).toHaveAttribute(
      "translate",
      "no",
    );
    for (const input of wordInputs()) {
      expect(input).toHaveAttribute("type", "text");
      expect(input).toHaveAttribute("autocomplete", "off");
      expect(input).toHaveAttribute("autocorrect", "off");
      expect(input).toHaveAttribute("autocapitalize", "off");
      expect(input).toHaveAttribute("spellcheck", "false");
      expect(input).toHaveAttribute("translate", "no");
      expect(input).toHaveAttribute("data-1p-ignore");
      expect(input).toHaveAttribute("data-lpignore", "true");
      expect(input).toHaveAttribute("data-bwignore");
      expect(input).not.toHaveAttribute("name");
    }
  });

  it("imports, shows the pubky, and only then continues", async () => {
    const user = userEvent.setup();
    let finish: (result: LocalIdentityImportResult) => void = () => undefined;
    const importIdentity = vi.fn<ImportIdentity>(async (_source, onKeyRecovered) => {
      onKeyRecovered?.({ publicKeyZ32: PUBLIC_KEY });
      return new Promise<LocalIdentityImportResult>((resolve) => {
        finish = resolve;
      });
    });
    const { onComplete } = renderFlow({ importIdentity });
    await openPhrase(user);
    paste(wordInputs()[0]!, PHRASE);
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(importIdentity).toHaveBeenCalledWith(
      { kind: "recovery-phrase", words: WORDS },
      expect.any(Function),
    );
    expect(await screen.findByText("Signing in as")).toBeVisible();
    expect(screen.getByText(PUBLIC_KEY)).toBeVisible();
    expect(screen.getByRole("button", { name: "Restoring…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    for (const input of wordInputs()) expect(input).toBeDisabled();

    await act(async () => {
      finish(Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY }, alreadyStored: false }));
    });
    expect(await screen.findByRole("heading", { name: "Pubky imported." })).toBeVisible();
    expect(screen.getByText(PUBLIC_KEY)).toBeVisible();
    expect(
      screen.getByText(/Your identity is self-managed, and recoverable only with your backup./u),
    ).toBeVisible();
    expect(onComplete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("says when the identity was already in this browser", async () => {
    const user = userEvent.setup();
    renderFlow({
      importIdentity: async () =>
        Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY }, alreadyStored: true }),
    });
    await openPhrase(user);
    paste(wordInputs()[0]!, PHRASE);
    await user.keyboard("{Enter}");
    expect(
      await screen.findByText("This pubky was already in this browser. Passport switched to it."),
    ).toBeVisible();
    expect(screen.queryByText(/self-managed/u)).toBeNull();
  });

  it.each([
    [
      "invalid_recovery_phrase",
      "This recovery phrase is not valid. Check the words and their order.",
    ],
    [
      "homeserver_not_found",
      "This pubky has no homeserver, so Passport cannot sign in with it. Nothing was saved.",
    ],
    ["homeserver_unreachable", "Could not connect. Check your connection and try again."],
    ["signin_failed", "Could not sign in to this pubky's homeserver. Nothing was saved."],
    [
      "storage_unavailable",
      "Your browser couldn't save your identity. Check your browser's storage settings and try again.",
    ],
  ] as const)("shows %s without echoing the words", async (code, message) => {
    const user = userEvent.setup();
    renderFlow({ importIdentity: async () => Result.err({ code }) });
    await openPhrase(user);
    paste(wordInputs()[0]!, PHRASE);
    await user.click(screen.getByRole("button", { name: "Restore" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    for (const word of WORDS) expect(alert.textContent).not.toContain(word);
    // The words stay so a typo can be fixed; Restore is available again.
    expect(wordInputs().map((input) => input.value)).toEqual(WORDS);
    expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled();
  });

  it("contains a rejected import", async () => {
    const user = userEvent.setup();
    renderFlow({
      importIdentity: async () => {
        throw new Error("boom");
      },
    });
    await openPhrase(user);
    paste(wordInputs()[0]!, PHRASE);
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not sign in. Please try again.",
    );
  });
});

describe("recovery file import", () => {
  function recoveryFile(name = "pubky-backup.pkarr", size = 91) {
    return new File([new Uint8Array(size).fill(7)], name, { type: "application/octet-stream" });
  }

  it("decrypts the selected .pkarr file with the password", async () => {
    const user = userEvent.setup();
    const importIdentity = vi.fn<ImportIdentity>(async () =>
      Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY }, alreadyStored: false }),
    );
    renderFlow({ importIdentity });
    await openFile(user);
    const restore = screen.getByRole("button", { name: "Restore" });
    const fileInput = document.querySelector<HTMLInputElement>("input[type=file]")!;
    expect(fileInput).toHaveAttribute("accept", ".pkarr");
    expect(restore).toBeDisabled();

    await user.upload(fileInput, recoveryFile());
    expect(screen.getByText("pubky-backup.pkarr")).toBeVisible();
    expect(restore).toBeDisabled();
    await user.type(screen.getByLabelText("Enter password"), "secret-password");
    expect(restore).toBeEnabled();
    await user.click(restore);

    expect(await screen.findByRole("heading", { name: "Pubky imported." })).toBeVisible();
    const [source] = importIdentity.mock.calls[0]!;
    expect(source).toEqual({
      kind: "recovery-file",
      bytes: expect.any(Uint8Array),
      password: "secret-password",
    });
    expect(source.kind === "recovery-file" && source.bytes.byteLength).toBe(91);
  });

  it.each([
    ["another extension", recoveryFile("backup.txt"), "Please select a .pkarr file."],
    [
      "an oversized file",
      recoveryFile("big.pkarr", 4096),
      "This file is too large to be a recovery file. Please select a .pkarr file.",
    ],
  ])("refuses %s before reading it", async (_label, file, message) => {
    const user = userEvent.setup({ applyAccept: false });
    const importIdentity = vi.fn<ImportIdentity>();
    renderFlow({ importIdentity });
    await openFile(user);
    await user.upload(document.querySelector<HTMLInputElement>("input[type=file]")!, file);
    await user.type(screen.getByLabelText("Enter password"), "secret-password");

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByText("No file selected")).toBeVisible();
    expect(screen.getByRole("button", { name: "Restore" })).toBeDisabled();
    expect(importIdentity).not.toHaveBeenCalled();
  });

  it.each([
    [
      "recovery_file_undecryptable",
      "Invalid password or corrupted file. Please check your password and try again.",
    ],
    ["invalid_recovery_file", "This file is not a recovery file. Please select a .pkarr file."],
    ["import_failed", "Could not sign in. Please try again."],
  ] as const)("shows %s and keeps the form for another try", async (code, message) => {
    const user = userEvent.setup();
    renderFlow({
      importIdentity: async (_source, onKeyRecovered) => {
        if (code === "import_failed") onKeyRecovered?.({ publicKeyZ32: PUBLIC_KEY });
        return Result.err({ code });
      },
    });
    await openFile(user);
    await user.upload(
      document.querySelector<HTMLInputElement>("input[type=file]")!,
      recoveryFile(),
    );
    await user.type(screen.getByLabelText("Enter password"), "secret-password{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled();
    if (code === "import_failed") expect(screen.getByText(PUBLIC_KEY)).toBeVisible();
    await user.type(screen.getByLabelText("Enter password"), "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a file the browser cannot read", async () => {
    const user = userEvent.setup();
    const importIdentity = vi.fn<ImportIdentity>();
    renderFlow({ importIdentity });
    await openFile(user);
    const file = recoveryFile();
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error("gone"));
    await user.upload(document.querySelector<HTMLInputElement>("input[type=file]")!, file);
    await user.type(screen.getByLabelText("Enter password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not read this file. Please select it again.",
    );
    expect(importIdentity).not.toHaveBeenCalled();
  });

  it("goes back to the choice, and from there to the providers", async () => {
    const user = userEvent.setup();
    renderFlow({ apple: TEST_APPLE_CONFIGURATION });
    await openFile(user);
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(await screen.findByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: LINK })).toBeVisible();
  });
});
