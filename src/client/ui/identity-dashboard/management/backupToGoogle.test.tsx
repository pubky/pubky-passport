/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import type { GoogleIdentityCredentials } from "@/client/logic/google-identity/gia/GoogleImplicitAuthorization";
import { GoogleIdentityController } from "@/client/logic/google-identity/GoogleIdentityController";
import {
  GoogleIdentityLifecycle,
  type UnlinkedGoogleBackups,
} from "@/client/logic/google-identity/GoogleIdentityLifecycle";
import { DRIVE_PERMISSION_HINT } from "@/client/ui/googleDrivePermissionPrompt";
import { BackupToGoogle } from "./backupToGoogle";

const publicIdentity = { publicKeyZ32: "identity" };
afterEach(cleanup);

describe("BackupToGoogle", () => {
  it("starts only on user action, offers optional-copy consent, then completes", async () => {
    const backupIdentity = vi
      .fn()
      .mockResolvedValueOnce(Result.err({ code: "visible_backup_permission_missing" }));
    const continueBackupWithoutVisibleCopy = vi
      .fn()
      .mockResolvedValueOnce(Result.ok({ visibleRecoveryCopyStatus: "skipped" }));
    const controller = mockGoogleIdentityController({
      backupIdentity,
      continueBackupWithoutVisibleCopy,
    });
    const onBack = vi.fn();
    render(
      withPassportTestProviders(
        <BackupToGoogle publicIdentity={publicIdentity} onBack={onBack} />,
        {
          createGoogleIdentityController: () => controller,
        },
      ),
    );
    expect(backupIdentity).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attach to Google" }));
    expect(backupIdentity).toHaveBeenCalledWith(publicIdentity);
    await user.click(
      await screen.findByRole("button", { name: "Continue without visible backup" }),
    );
    expect(continueBackupWithoutVisibleCopy).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(/Your private Google Drive backup is ready/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("primes both permissions, then waits for Google's window with Cancel and Show", async () => {
    const backupIdentity = vi.fn(() => new Promise<never>(() => undefined));
    const controller = mockGoogleIdentityController({ backupIdentity });
    render(
      withPassportTestProviders(
        <BackupToGoogle publicIdentity={publicIdentity} onBack={vi.fn()} />,
        { createGoogleIdentityController: () => controller },
      ),
    );
    expect(screen.getByText(/^Sign in with Google and keep/)).toHaveTextContent(
      DRIVE_PERMISSION_HINT,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attach to Google" }));

    expect(
      screen.getByRole("heading", { name: "Requesting Google Drive access." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Google…");
    await user.click(screen.getByRole("button", { name: "Show Google’s window" }));
    expect(controller.showAuthorizationWindow).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(controller.cancelAuthorization).toHaveBeenCalledOnce();
    expect(await screen.findByRole("button", { name: "Attach to Google" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Once Google answered, the attach screen shows its own progress.
    await user.click(screen.getByRole("button", { name: "Attach to Google" }));
    act(() => controller.emitState({ status: "backing-up" }));
    expect(screen.getByRole("button", { name: "Attaching…" })).toHaveAttribute("aria-busy", "true");
  });

  it("shows permission guidance and retries with a fresh account choice", async () => {
    const backupIdentity = vi
      .fn()
      .mockResolvedValue(Result.err({ code: "google_drive_access_required" }));
    const controller = mockGoogleIdentityController({ backupIdentity });
    render(
      withPassportTestProviders(
        <BackupToGoogle publicIdentity={publicIdentity} onBack={vi.fn()} />,
        {
          createGoogleIdentityController: () => controller,
        },
      ),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attach to Google" }));
    expect(
      await screen.findByRole("heading", { name: "Drive access required." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue without visible backup" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(backupIdentity).toHaveBeenCalledTimes(2);
    expect(controller.reset).toHaveBeenCalledOnce();
  });

  it("shows an existing-backup conflict with a retry icon and fresh authorization", async () => {
    const backupIdentity = vi
      .fn()
      .mockResolvedValue(Result.err({ code: "google_backup_conflict" }));
    const controller = mockGoogleIdentityController({ backupIdentity });
    render(
      withPassportTestProviders(
        <BackupToGoogle publicIdentity={publicIdentity} onBack={vi.fn()} />,
        { createGoogleIdentityController: () => controller },
      ),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attach to Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already has a Passport backup");
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry.querySelector("svg")).not.toBeNull();
    await user.click(retry);
    expect(controller.reset).toHaveBeenCalledOnce();
    expect(backupIdentity).toHaveBeenCalledTimes(2);
  });

  it("retries an unlinked backup with the same Google account", async () => {
    const backupIdentity = vi
      .fn()
      .mockResolvedValueOnce(Result.err({ code: "google_backup_created_not_linked" }))
      .mockResolvedValueOnce(Result.ok({ visibleRecoveryCopyStatus: "created" }));
    const controller = mockGoogleIdentityController({ backupIdentity });
    render(
      withPassportTestProviders(
        <BackupToGoogle publicIdentity={publicIdentity} onBack={vi.fn()} />,
        { createGoogleIdentityController: () => controller },
      ),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attach to Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Try again to finish attaching the same Google account",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Google account attached." }),
    ).toBeInTheDocument();
    expect(controller.reset).not.toHaveBeenCalled();
    expect(backupIdentity).toHaveBeenCalledTimes(2);
  });

  it("describes attach failures in attach terms rather than detach terms", async () => {
    const backupIdentity = vi
      .fn()
      .mockResolvedValueOnce(Result.err({ code: "google_account_mismatch" }))
      .mockResolvedValueOnce(Result.err({ code: "drive_read_failed" }))
      .mockResolvedValueOnce(Result.err({ code: "google_backup_created_not_linked" }));
    const controller = mockGoogleIdentityController({ backupIdentity });
    render(
      withPassportTestProviders(
        <BackupToGoogle publicIdentity={publicIdentity} onBack={vi.fn()} />,
        { createGoogleIdentityController: () => controller },
      ),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attach to Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already attached to a different Google account",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("remove Google access. Please");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not check this Google account for an existing Passport backup",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "backup was saved to Google Drive, but Passport could not record the link",
    );
  });
});

const STORAGE_ROOT = "pubky-passport/local-identities/v1";
const PUBLIC_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECRET_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const PASSPORT_ORIGIN = "https://passport.pubky.app";
const GOOGLE_ACCOUNT = {
  googleSubject: "google-account",
  email: "user@example.com",
  name: "User",
  pictureUrl: null,
};
const CREDENTIALS: GoogleIdentityCredentials = {
  googleIdToken: "google-id-token",
  driveAccessToken: "drive-access-token",
  driveAccessTokenExpiresAt: Date.now() + 3_600_000,
  visibleBackupPermissionGranted: true,
  googleAccount: GOOGLE_ACCOUNT,
};

/**
 * The complete attach flow through the real controller, lifecycle, Drive stores, Web Crypto,
 * and local repository. Only the Google popup, Google Drive, and the Passport wrapping-key
 * endpoint are faked. (Playwright cannot cover this flow: its server runs on plain HTTP, and
 * Passport files are only written for an https origin.)
 */
describe("BackupToGoogle attaching through the real Google identity stack", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      `${STORAGE_ROOT}/identity/${PUBLIC_KEY}`,
      JSON.stringify({ v: 1, publicKeyZ32: PUBLIC_KEY, secretKey: SECRET_KEY }),
    );
    localStorage.setItem(`${STORAGE_ROOT}/active`, PUBLIC_KEY);
    vi.stubGlobal(
      "open",
      vi.fn(() => ({ closed: false, close: vi.fn(), location: { replace: vi.fn() } })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("backs up the local key to an empty account, with a visible copy, and links it", async () => {
    const google = fakeGoogleServices();
    renderWithRealController(google.fetch, CREDENTIALS);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Attach to Google" }));

    expect(
      await screen.findByRole("heading", { name: "Google account attached." }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/visible recovery copy/)).not.toBeInTheDocument();
    expect(google.uploads.map(({ name, parents }) => ({ name, parents }))).toEqual([
      { name: "passport.json", parents: ["appDataFolder"] },
      { name: `${PUBLIC_KEY}.json`, parents: ["visible-folder"] },
    ]);
    expect(JSON.parse(google.uploads[0]?.contents ?? "null")).toMatchObject({
      v: 1,
      keyId: "test-key",
      url: PASSPORT_ORIGIN,
    });
    expect(JSON.stringify(google.uploads)).not.toContain(SECRET_KEY);
    expect(google.wrappingKeyRequests).toEqual([{ googleIdToken: CREDENTIALS.googleIdToken }]);
    expect(storedIdentity()).toEqual({
      v: 1,
      publicKeyZ32: PUBLIC_KEY,
      secretKey: SECRET_KEY,
      googleAccount: GOOGLE_ACCOUNT,
    });
    expect(localStorage.getItem(`${STORAGE_ROOT}/active`)).toBe(PUBLIC_KEY);
  });

  it("looks up the account first, then attaches without a visible copy once the user agrees", async () => {
    const google = fakeGoogleServices();
    renderWithRealController(google.fetch, {
      ...CREDENTIALS,
      visibleBackupPermissionGranted: false,
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Attach to Google" }));
    expect(
      await screen.findByRole("heading", { name: "Drive access optional." }),
    ).toBeInTheDocument();
    expect(google.requests).toEqual(["GET appDataFolder"]);
    expect(google.wrappingKeyRequests).toEqual([]);
    expect(storedIdentity()).not.toHaveProperty("googleAccount");

    await user.click(screen.getByRole("button", { name: "Continue without visible backup" }));

    expect(
      await screen.findByRole("heading", { name: "Google account attached." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/No visible recovery copy was created/)).toBeInTheDocument();
    expect(google.uploads.map(({ name }) => name)).toEqual(["passport.json"]);
    // Occupancy check, its repeat after consent, then the create with its before/after checks.
    expect(google.requests).toEqual([
      "GET appDataFolder",
      "GET appDataFolder",
      "GET appDataFolder",
      "POST /upload/drive/v3/files",
      "GET appDataFolder",
    ]);
    expect(storedIdentity()).toEqual({
      v: 1,
      publicKeyZ32: PUBLIC_KEY,
      secretKey: SECRET_KEY,
      googleAccount: GOOGLE_ACCOUNT,
    });
  });

  it("finishes linking a saved backup after the user leaves and reopens the screen", async () => {
    const google = fakeGoogleServices();
    const unlinkedBackups: UnlinkedGoogleBackups = new Map();
    const identityKey = `${STORAGE_ROOT}/identity/${PUBLIC_KEY}`;
    const setItem = Storage.prototype.setItem;
    let storageFails = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (storageFails && key === identityKey) throw new Error("storage full");
      setItem.call(this, key, value);
    });
    renderWithRealController(google.fetch, CREDENTIALS, unlinkedBackups);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Attach to Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Passport could not record the link",
    );
    expect(storedIdentity()).not.toHaveProperty("googleAccount");

    cleanup();
    storageFails = false;
    renderWithRealController(google.fetch, CREDENTIALS, unlinkedBackups);
    await user.click(screen.getByRole("button", { name: "Attach to Google" }));

    expect(
      await screen.findByRole("heading", { name: "Google account attached." }),
    ).toBeInTheDocument();
    expect(google.uploads.map(({ name }) => name)).toEqual(["passport.json", `${PUBLIC_KEY}.json`]);
    expect(google.wrappingKeyRequests).toHaveLength(1);
    expect(storedIdentity()).toMatchObject({ googleAccount: GOOGLE_ACCOUNT });
  });
});

function renderWithRealController(
  fetch: typeof globalThis.fetch,
  credentials: GoogleIdentityCredentials,
  unlinkedBackups: UnlinkedGoogleBackups = new Map(),
) {
  const createController = (googleClientId: string, homegateBaseUrl: string) =>
    new GoogleIdentityController(
      googleClientId,
      homegateBaseUrl,
      () => ({
        request: async () => Result.ok(credentials),
        cancel: () => undefined,
        dispose: () => undefined,
      }),
      (homegate) =>
        new GoogleIdentityLifecycle(homegate, PASSPORT_ORIGIN, {
          fetch,
          pubky: {
            createIdentityKey: vi.fn(),
            exportSecretKey: vi.fn(),
            restoreIdentityKey: vi.fn(),
            signup: vi.fn(),
            signin: vi.fn(),
            resolveHomeserver: vi.fn(),
            publishHomeserver: vi.fn(),
            disposeIdentityKey: vi.fn(),
            dispose: vi.fn(),
          },
          unlinkedBackups,
        }),
    );
  render(
    withPassportTestProviders(
      <BackupToGoogle publicIdentity={{ publicKeyZ32: PUBLIC_KEY }} onBack={vi.fn()} />,
      { createGoogleIdentityController: createController },
    ),
  );
}

function storedIdentity(): unknown {
  return JSON.parse(localStorage.getItem(`${STORAGE_ROOT}/identity/${PUBLIC_KEY}`) ?? "null");
}

/** An in-memory Google Drive and Passport wrapping-key endpoint for one Google account. */
function fakeGoogleServices() {
  type DriveFile = Record<string, unknown> & { id: string };
  const requests: string[] = [];
  const uploads: Array<{ name: string; parents: string[]; contents: string }> = [];
  const wrappingKeyRequests: unknown[] = [];
  const files = new Map<string, DriveFile>();
  let passportFile: DriveFile | undefined;
  let folder: DriveFile | undefined;

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), PASSPORT_ORIGIN);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    if (url.pathname === "/api/wrapping-key/google") {
      wrappingKeyRequests.push(JSON.parse(body));
      return Response.json({
        wrappingKey: Buffer.alloc(32, 9).toString("base64url"),
        keyId: "test-key",
      });
    }
    const spaces = url.searchParams.get("spaces");
    requests.push(`${method} ${spaces ?? url.pathname}`);
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const listed = spaces === "appDataFolder" ? passportFile : folder;
      if (!listed) return Response.json({ files: [] });
      const { id, name, version, mimeType } = listed;
      return Response.json({
        files: [spaces === "appDataFolder" ? { id, name, version } : { id, name, mimeType }],
      });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const metadata = JSON.parse(body) as { name: string; mimeType: string };
      folder = { id: "visible-folder", ...metadata, trashed: false };
      const { id, name, mimeType, trashed } = folder;
      return Response.json({ id, name, mimeType, trashed });
    }
    if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
      // Multipart parts: metadata JSON on the fourth line, file contents on the eighth.
      const lines = body.split("\r\n");
      const metadata = JSON.parse(lines[3] ?? "{}") as { name: string; parents: string[] };
      uploads.push({ ...metadata, contents: lines[7] ?? "" });
      const file: DriveFile = {
        id: metadata.parents[0] === "appDataFolder" ? "passport-file" : "visible-copy",
        name: metadata.name,
        version: "1",
        trashed: false,
        parents: metadata.parents,
      };
      files.set(file.id, file);
      if (file.id === "passport-file") passportFile = file;
      return Response.json({ id: file.id, name: file.name, version: file.version });
    }
    const file = files.get(decodeURIComponent(url.pathname.split("/").at(-1) ?? ""));
    if (method === "GET" && file) return Response.json(file);
    return Response.json({ error: "unexpected Drive request" }, { status: 404 });
  });

  return { fetch, requests, uploads, wrappingKeyRequests };
}
