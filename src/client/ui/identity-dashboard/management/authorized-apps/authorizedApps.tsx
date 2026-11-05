import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  LocalIdentityAuthorizedAppRevocationResult,
  LocalIdentityAuthorizedAppsResult,
} from "@/client/logic/local-identity/LocalIdentityController";
import type { PubkyAuthorizedApp } from "@/client/logic/pubky/PubkySdkAdapter";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { ArrowRightIcon, KeyRoundIcon, RotateCcwIcon, XIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";
import { Dialog } from "@/client/ui/shared/primitives/dialog";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { IconButton } from "@/client/ui/shared/primitives/iconButton";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { AUTHORIZED_APP_DIALOG_CLASS_NAME, AuthorizedAppDialog } from "./authorizedAppDialog";
import { expiryLabel, permissionSummary } from "./authorizedAppDisplay";

/** More apps than this move into the "Show all" dialog so the page keeps its height. */
const INLINE_APP_LIMIT = 3;

type AuthorizedAppsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; apps: readonly PubkyAuthorizedApp[] };

function AuthorizedApps({
  listAuthorizedApps,
  revokeAuthorizedApp,
}: {
  listAuthorizedApps: () => Promise<LocalIdentityAuthorizedAppsResult>;
  revokeAuthorizedApp: (grantId: string) => Promise<LocalIdentityAuthorizedAppRevocationResult>;
}) {
  const [state, setState] = useState<AuthorizedAppsState>({ status: "loading" });
  const [selectedGrantId, setSelectedGrantId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const allAppsHeading = useRef<HTMLHeadingElement>(null);
  const focusHeadingAfterClose = useRef(false);
  const latestRequest = useRef(0);
  const mounted = useRef(true);
  // Callers pass inline closures; loading once per mount avoids a homeserver sign-in per render.
  const listApps = useRef(listAuthorizedApps);
  useEffect(() => {
    listApps.current = listAuthorizedApps;
  }, [listAuthorizedApps]);

  const fetchApps = useCallback(async (): Promise<AuthorizedAppsState> => {
    try {
      const listed = await listApps.current();
      return Result.isOk(listed) ? { status: "ready", apps: listed.value } : { status: "error" };
    } catch (e) {
      LOGGER.warn("identity.management.failed", {
        operation: "list_authorized_apps",
        ...safeErrorLogFields(e),
      });
      return { status: "error" };
    }
  }, []);

  const load = useCallback(
    async (mode: "initial" | "retry" | "refresh") => {
      const request = ++latestRequest.current;
      const next = await fetchApps();
      if (!mounted.current || request !== latestRequest.current) return;
      // A failed background refresh keeps the list the user is looking at.
      setState((current) =>
        next.status === "error" && mode === "refresh" && current.status === "ready"
          ? current
          : next,
      );
    },
    [fetchApps],
  );

  useEffect(() => {
    mounted.current = true;
    void load("initial");
    return () => {
      mounted.current = false;
    };
  }, [load]);

  // The row that opened the dialog is gone after a revoke, so keep focus in the open list.
  useEffect(() => {
    if (selectedGrantId !== null || !focusHeadingAfterClose.current) return;
    focusHeadingAfterClose.current = false;
    (allAppsHeading.current ?? heading.current)?.focus();
  }, [selectedGrantId]);

  const apps = state.status === "ready" ? state.apps : [];
  const selectedApp = apps.find((app) => app.grantId === selectedGrantId);
  // Once every app fits inline the dialog has nothing more to show.
  if (showAll && apps.length <= INLINE_APP_LIMIT) setShowAll(false);

  async function revoke(app: PubkyAuthorizedApp): Promise<boolean> {
    let revoked: LocalIdentityAuthorizedAppRevocationResult;
    try {
      revoked = await revokeAuthorizedApp(app.grantId);
    } catch (e) {
      LOGGER.warn("identity.management.failed", {
        operation: "revoke_authorized_app",
        ...safeErrorLogFields(e),
      });
      return false;
    }
    if (Result.isError(revoked)) return false;
    if (!mounted.current) return true;

    latestRequest.current += 1;
    setSelectedGrantId(null);
    setState((current) =>
      current.status === "ready"
        ? {
            status: "ready",
            apps: current.apps.filter((candidate) => candidate.grantId !== app.grantId),
          }
        : current,
    );
    toast.info("Access revoked", { description: app.clientId });
    focusHeadingAfterClose.current = true;
    void load("refresh");
    return true;
  }

  return (
    <section aria-labelledby="authorized-apps-heading" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2
          className="text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground outline-none"
          id="authorized-apps-heading"
          ref={heading}
          tabIndex={-1}
        >
          Authorized apps
        </h2>
        {state.status === "ready" && apps.length > 0 ? (
          // The list already exposes its item count to assistive technology.
          <span
            aria-hidden="true"
            className="rounded-full bg-brand/16 px-2 text-xs font-semibold leading-5 text-brand"
          >
            {apps.length}
          </span>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <p className="flex items-center gap-2 text-sm leading-5 text-muted-foreground">
          <Spinner aria-hidden="true" className="size-4" />
          Loading authorized apps…
        </p>
      ) : null}

      {state.status === "error" ? (
        <div className="flex flex-col items-start gap-3">
          <FieldMessage error>Could not load authorized apps.</FieldMessage>
          <Button
            onClick={() => {
              setState({ status: "loading" });
              void load("retry");
            }}
            size="sm"
            variant="secondary"
          >
            <RotateCcwIcon />
            Try again
          </Button>
        </div>
      ) : null}

      {state.status === "ready" && apps.length === 0 ? (
        <p className="text-sm leading-5 text-muted-foreground">
          No apps have access to this identity.
        </p>
      ) : null}

      {state.status === "ready" && apps.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {apps.slice(0, INLINE_APP_LIMIT).map((app) => (
            <AuthorizedAppRow app={app} key={app.grantId} onSelect={setSelectedGrantId} />
          ))}
        </ul>
      ) : null}

      {state.status === "ready" && apps.length > INLINE_APP_LIMIT ? (
        <Button
          aria-haspopup="dialog"
          className="w-full"
          onClick={() => setShowAll(true)}
          variant="secondary"
        >
          Show all ({apps.length})
        </Button>
      ) : null}

      {showAll ? (
        <Dialog
          aria-labelledby="all-authorized-apps-title"
          className={AUTHORIZED_APP_DIALOG_CLASS_NAME}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setShowAll(false);
          }}
          open
        >
          <IconButton
            aria-label="Close"
            className="absolute right-[15px] top-[15px]"
            onClick={() => setShowAll(false)}
            type="button"
            variant="secondary"
          >
            <XIcon className="opacity-70" />
          </IconButton>
          <div className="flex max-h-[calc(100dvh-6rem)] flex-col gap-6">
            <h2
              className="pr-10 text-xl font-bold leading-7 outline-none"
              id="all-authorized-apps-title"
              ref={allAppsHeading}
              tabIndex={-1}
            >
              Authorized apps
            </h2>
            <ul className="-m-1 flex max-h-[60dvh] min-h-0 flex-col gap-2 overflow-y-auto p-1">
              {apps.map((app) => (
                <AuthorizedAppRow app={app} key={app.grantId} onSelect={setSelectedGrantId} />
              ))}
            </ul>
            <Button
              className="w-full"
              onClick={() => setShowAll(false)}
              size="lg"
              variant="outline"
            >
              Done
            </Button>
          </div>
        </Dialog>
      ) : null}

      {selectedApp ? (
        <AuthorizedAppDialog
          app={selectedApp}
          onClose={() => setSelectedGrantId(null)}
          onRevoke={() => revoke(selectedApp)}
        />
      ) : null}
    </section>
  );
}

function AuthorizedAppRow({
  app,
  onSelect,
}: {
  app: PubkyAuthorizedApp;
  onSelect: (grantId: string) => void;
}) {
  return (
    <li>
      <button
        aria-haspopup="dialog"
        className="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-card p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => onSelect(app.grantId)}
        type="button"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <KeyRoundIcon />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <bdi className="truncate font-medium leading-6" dir="ltr">
            {app.clientId}
          </bdi>
          <span className="truncate text-xs leading-4 text-muted-foreground">
            {permissionSummary(app)} · {expiryLabel(app, { withTime: false })}
          </span>
        </span>
        <ArrowRightIcon className="shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

export { AuthorizedApps };
