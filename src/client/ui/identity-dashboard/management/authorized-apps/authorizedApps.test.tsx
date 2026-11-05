/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  LocalIdentityAuthorizedAppRevocationResult,
  LocalIdentityAuthorizedAppsResult,
} from "@/client/logic/local-identity/LocalIdentityController";
import type { PubkyAuthorizedApp } from "@/client/logic/pubky/PubkySdkAdapter";
import { LOGGER } from "@/libs/logger/logger";
import { AuthorizedApps } from "./authorizedApps";

const MOCKS = vi.hoisted(() => ({ toastInfo: vi.fn() }));

vi.mock("sonner", () => ({ toast: { info: MOCKS.toastInfo } }));

const DEMO_APP: PubkyAuthorizedApp = {
  grantId: "grant-demo",
  clientId: "demo.pubky.app",
  capabilities: ["/pub/demo.pubky.app/:rw", "/pub/shared/:r", "/pub/vault/:e"],
  issuedAt: 1_767_225_600,
  expiresAt: 0,
};
const NOTES_APP: PubkyAuthorizedApp = {
  grantId: "grant-notes",
  clientId: "notes.example",
  capabilities: ["/pub/notes.example/:r"],
  issuedAt: 1_767_225_600,
  expiresAt: 1_769_904_000,
};

function manyApps(count: number): PubkyAuthorizedApp[] {
  return Array.from({ length: count }, (_, index) => ({
    ...NOTES_APP,
    grantId: `grant-${index + 1}`,
    clientId: `app-${index + 1}.example`,
  }));
}

describe("AuthorizedApps", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("shows a loading state, then each app with its permission count", async () => {
    let settle!: (result: LocalIdentityAuthorizedAppsResult) => void;
    renderApps({
      listAuthorizedApps: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    });

    expect(screen.getByText("Loading authorized apps…")).toBeInTheDocument();
    settle(Result.ok([DEMO_APP, NOTES_APP]));

    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(screen.getByRole("region", { name: "Authorized apps" })).getByText("2"),
    ).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: /demo\.pubky\.app/ })).toHaveTextContent(
      "3 permissions · Does not expire",
    );
    expect(screen.getByRole("button", { name: /notes\.example/ })).toHaveTextContent(
      "1 permission · Expires",
    );
  });

  it("shows an empty state when no app has access", async () => {
    renderApps({ listAuthorizedApps: async () => Result.ok([]) });

    expect(await screen.findByText("No apps have access to this identity.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows a retryable error when the list cannot be loaded", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const listAuthorizedApps = vi
      .fn<() => Promise<LocalIdentityAuthorizedAppsResult>>()
      .mockResolvedValueOnce(Result.err({ code: "authorized_apps_unavailable" }))
      .mockRejectedValueOnce(new Error("SECRET-LIST-CANARY"))
      .mockResolvedValueOnce(Result.ok([DEMO_APP]));
    renderApps({ listAuthorizedApps });
    const user = userEvent.setup();

    expect(await screen.findByText("Could not load authorized apps.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Could not load authorized apps.")).toBeInTheDocument();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-LIST-CANARY");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /demo\.pubky\.app/ })).toBeInTheDocument();
    expect(listAuthorizedApps).toHaveBeenCalledTimes(3);
  });

  it("shows granted permissions and expiry for one app", async () => {
    renderApps({ listAuthorizedApps: async () => Result.ok([DEMO_APP]) });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /demo\.pubky\.app/ }));

    const dialog = screen.getByRole("dialog", { name: "demo.pubky.app" });
    expect(within(dialog).getByText("Granted permissions")).toBeInTheDocument();
    expect(within(dialog).getByText("/pub/demo.pubky.app/")).toBeInTheDocument();
    expect(within(dialog).getByText("Read,write")).toBeInTheDocument();
    expect(within(dialog).getByText("/pub/shared/")).toBeInTheDocument();
    expect(within(dialog).getByText("Read")).toBeInTheDocument();
    expect(within(dialog).getByText("/pub/vault/")).toBeInTheDocument();
    expect(within(dialog).getByText("Encrypt")).toBeInTheDocument();
    expect(within(dialog).getByText("Does not expire")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("revokes an app only after confirmation and refreshes the list", async () => {
    const listAuthorizedApps = vi
      .fn<() => Promise<LocalIdentityAuthorizedAppsResult>>()
      .mockResolvedValueOnce(Result.ok([DEMO_APP, NOTES_APP]))
      .mockResolvedValueOnce(Result.ok([NOTES_APP]));
    const revokeAuthorizedApp = vi.fn(async () => Result.ok());
    renderApps({ listAuthorizedApps, revokeAuthorizedApp });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /demo\.pubky\.app/ }));
    await user.click(screen.getByRole("button", { name: "Revoke access" }));
    expect(screen.getByRole("dialog", { name: "Revoke access?" })).toBeInTheDocument();
    expect(revokeAuthorizedApp).not.toHaveBeenCalled();

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /demo\.pubky\.app/ }));
    await user.click(screen.getByRole("button", { name: "Revoke access" }));
    await user.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(revokeAuthorizedApp).toHaveBeenCalledWith("grant-demo");
    expect(screen.queryByRole("button", { name: /demo\.pubky\.app/ })).not.toBeInTheDocument();
    expect(MOCKS.toastInfo).toHaveBeenCalledWith("Access revoked", {
      description: "demo.pubky.app",
    });
    expect(screen.getByRole("heading", { name: "Authorized apps" })).toHaveFocus();
    await waitFor(() => expect(listAuthorizedApps).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /notes\.example/ })).toBeInTheDocument();
  });

  it("shows up to three apps inline without a Show all button", async () => {
    renderApps({ listAuthorizedApps: async () => Result.ok(manyApps(3)) });

    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("shows three apps inline and the rest behind Show all", async () => {
    renderApps({ listAuthorizedApps: async () => Result.ok(manyApps(8)) });
    const user = userEvent.setup();

    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByRole("button", { name: /app-3\.example/ })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: /app-4\.example/ })).not.toBeInTheDocument();
    const region = screen.getByRole("region", { name: "Authorized apps" });
    expect(within(region).getByText("8")).toHaveAttribute("aria-hidden", "true");

    await user.click(screen.getByRole("button", { name: "Show all (8)" }));
    const dialog = screen.getByRole("dialog", { name: "Authorized apps" });
    expect(within(within(dialog).getByRole("list")).getAllByRole("listitem")).toHaveLength(8);
    for (const app of manyApps(8)) {
      expect(
        within(dialog).getByRole("button", { name: new RegExp(app.clientId) }),
      ).toBeInTheDocument();
    }

    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("revokes an app from the Show all list and updates both lists", async () => {
    const apps = manyApps(5);
    let settleRefresh!: (result: LocalIdentityAuthorizedAppsResult) => void;
    const listAuthorizedApps = vi
      .fn<() => Promise<LocalIdentityAuthorizedAppsResult>>()
      .mockResolvedValueOnce(Result.ok(apps))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settleRefresh = resolve;
          }),
      );
    const revokeAuthorizedApp = vi.fn(async () => Result.ok());
    renderApps({ listAuthorizedApps, revokeAuthorizedApp });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Show all (5)" }));
    const allApps = screen.getByRole("dialog", { name: "Authorized apps" });
    await user.click(within(allApps).getByRole("button", { name: /app-5\.example/ }));
    const details = screen.getByRole("dialog", { name: "app-5.example" });
    await user.click(within(details).getByRole("button", { name: "Revoke access" }));
    await user.click(screen.getByRole("button", { name: "Revoke" }));

    // Both lists drop the app before the background refresh answers.
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Revoke access?" })).not.toBeInTheDocument(),
    );
    expect(revokeAuthorizedApp).toHaveBeenCalledWith("grant-5");
    expect(listAuthorizedApps).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("dialog", { name: "Authorized apps" })).toBe(allApps);
    expect(within(within(allApps).getByRole("list")).getAllByRole("listitem")).toHaveLength(4);
    expect(within(allApps).queryByText("app-5.example")).not.toBeInTheDocument();
    expect(within(allApps).getByRole("heading", { name: "Authorized apps" })).toHaveFocus();
    const region = screen.getByRole("region", { name: "Authorized apps" });
    expect(within(region).getByText("4")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Show all (4)" })).toBeInTheDocument();

    // The refresh replaces both lists with what the homeserver reports.
    settleRefresh(Result.ok([...apps.slice(0, 4), { ...NOTES_APP, clientId: "new.example" }]));
    expect(await within(allApps).findByText("new.example")).toBeInTheDocument();
    expect(within(within(allApps).getByRole("list")).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Show all (5)" })).toBeInTheDocument();
    expect(within(region).getByText("5")).toHaveAttribute("aria-hidden", "true");

    await user.click(within(allApps).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes only the top dialog on Escape", async () => {
    renderApps({ listAuthorizedApps: async () => Result.ok(manyApps(4)) });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Show all (4)" }));
    const allApps = screen.getByRole("dialog", { name: "Authorized apps" });
    await user.click(within(allApps).getByRole("button", { name: /app-4\.example/ }));
    const details = screen.getByRole("dialog", { name: "app-4.example" });

    // jsdom does not turn Escape into the dialog's cancel event, so send it directly.
    fireEvent(details, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog", { name: "app-4.example" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Authorized apps" })).toBe(allApps);

    fireEvent(allApps, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the Show all list once the remaining apps fit inline", async () => {
    let remaining = manyApps(4);
    renderApps({
      listAuthorizedApps: async () => Result.ok(remaining),
      revokeAuthorizedApp: async (grantId) => {
        remaining = remaining.filter((app) => app.grantId !== grantId);
        return Result.ok();
      },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Show all (4)" }));
    const allApps = screen.getByRole("dialog", { name: "Authorized apps" });
    await user.click(within(allApps).getByRole("button", { name: /app-2\.example/ }));
    await user.click(screen.getByRole("button", { name: "Revoke access" }));
    await user.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).queryByText("app-2.example")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Authorized apps" })).toHaveFocus();
  });

  it("keeps the confirmation open with an error when revocation fails", async () => {
    let settle!: (result: LocalIdentityAuthorizedAppRevocationResult) => void;
    const revokeAuthorizedApp = vi.fn(
      () =>
        new Promise<LocalIdentityAuthorizedAppRevocationResult>((resolve) => {
          settle = resolve;
        }),
    );
    renderApps({ listAuthorizedApps: async () => Result.ok([DEMO_APP]), revokeAuthorizedApp });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /demo\.pubky\.app/ }));
    await user.click(screen.getByRole("button", { name: "Revoke access" }));
    await user.click(screen.getByRole("button", { name: "Revoke" }));

    expect(screen.getByRole("button", { name: "Revoking…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    settle(Result.err({ code: "revocation_failed" }));

    expect(
      await screen.findByText("Could not revoke access. Please try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeEnabled();
    expect(screen.getByRole("dialog", { name: "Revoke access?" })).toBeInTheDocument();
    expect(MOCKS.toastInfo).not.toHaveBeenCalled();
  });

  it("keeps the shown list when a refresh after revocation fails", async () => {
    const listAuthorizedApps = vi
      .fn<() => Promise<LocalIdentityAuthorizedAppsResult>>()
      .mockResolvedValueOnce(Result.ok([DEMO_APP, NOTES_APP]))
      .mockResolvedValueOnce(Result.err({ code: "authorized_apps_unavailable" }));
    renderApps({ listAuthorizedApps });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /demo\.pubky\.app/ }));
    await user.click(screen.getByRole("button", { name: "Revoke access" }));
    await user.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(listAuthorizedApps).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /notes\.example/ })).toBeInTheDocument();
    expect(screen.queryByText("Could not load authorized apps.")).not.toBeInTheDocument();
  });

  it("loads once even when the parent passes new callbacks", async () => {
    const listAuthorizedApps = vi.fn(async () => Result.ok([]));
    const { rerender } = renderApps({ listAuthorizedApps });
    await screen.findByText("No apps have access to this identity.");

    rerender(
      <AuthorizedApps
        listAuthorizedApps={() => listAuthorizedApps()}
        revokeAuthorizedApp={async () => Result.ok()}
      />,
    );

    expect(listAuthorizedApps).toHaveBeenCalledOnce();
  });
});

function renderApps({
  listAuthorizedApps,
  revokeAuthorizedApp = async () => Result.ok(),
}: {
  listAuthorizedApps: () => Promise<LocalIdentityAuthorizedAppsResult>;
  revokeAuthorizedApp?: (grantId: string) => Promise<LocalIdentityAuthorizedAppRevocationResult>;
}) {
  return render(
    <AuthorizedApps
      listAuthorizedApps={listAuthorizedApps}
      revokeAuthorizedApp={revokeAuthorizedApp}
    />,
  );
}
