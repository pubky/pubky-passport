import { useEffect, useRef, useState } from "react";

import type { PubkyAuthorizedApp } from "@/client/logic/pubky/PubkySdkAdapter";
import {
  formatPermissionAccess,
  PermissionList,
  PermissionRow,
} from "@/client/ui/authorization/review/permissionList";
import { KeyRoundIcon, XIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";
import { Dialog } from "@/client/ui/shared/primitives/dialog";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { IconButton } from "@/client/ui/shared/primitives/iconButton";
import { expiryLabel, formatGrantDate, parseAuthorizedAppPermission } from "./authorizedAppDisplay";

const AUTHORIZED_APP_DIALOG_CLASS_NAME =
  "mb-0 mt-auto w-full max-w-none rounded-t-xl border bg-popover p-6 text-foreground shadow-[0_50px_100px_rgba(5,5,10,0.75)] backdrop:bg-black/75 sm:m-auto sm:max-w-[375px] sm:rounded-xl";

/** Shows one authorized app and asks for confirmation before revoking it. */
function AuthorizedAppDialog({
  app,
  onClose,
  onRevoke,
}: {
  app: PubkyAuthorizedApp;
  onClose: () => void;
  /** Resolves `false` when the revocation failed and the dialog should stay open. */
  onRevoke: () => Promise<boolean>;
}) {
  const [step, setStep] = useState<"details" | "confirm">("details");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const rows = app.capabilities.flatMap((capability, index) => {
    const permission = parseAuthorizedAppPermission(capability);
    const labels = [
      ...(permission.read || permission.write ? [formatPermissionAccess(permission)] : []),
      ...(permission.encrypt ? ["Encrypt"] : []),
    ];
    return (labels.length > 0 ? labels : [""]).map((access) => ({
      access,
      key: `${index}:${access}`,
      path: permission.path,
    }));
  });

  // The confirm step replaces the focused button, so move focus into it.
  useEffect(() => {
    if (step === "confirm") cancelButton.current?.focus();
  }, [step]);

  function close() {
    if (!pending) onClose();
  }

  async function revoke() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    const revoked = await onRevoke();
    if (!revoked) {
      setPending(false);
      setFailed(true);
    }
  }

  return (
    <Dialog
      aria-describedby="authorized-app-description"
      aria-labelledby="authorized-app-title"
      className={AUTHORIZED_APP_DIALOG_CLASS_NAME}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      open
    >
      <IconButton
        aria-label="Close"
        className="absolute right-[15px] top-[15px]"
        disabled={pending}
        onClick={close}
        type="button"
        variant="secondary"
      >
        <XIcon className="opacity-70" />
      </IconButton>

      {step === "details" ? (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3 pr-10">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <KeyRoundIcon />
            </span>
            <div className="flex min-w-0 flex-col">
              <h2 className="break-all text-xl font-bold leading-7" id="authorized-app-title">
                <bdi dir="ltr">{app.clientId}</bdi>
              </h2>
              <p
                className="text-sm leading-5 text-muted-foreground"
                id="authorized-app-description"
              >
                Authorized {formatGrantDate(app.issuedAt)}
              </p>
            </div>
          </div>

          <PermissionList title="Granted permissions">
            {rows.length === 0 ? (
              <p className="text-sm font-medium text-muted-foreground">No data permissions.</p>
            ) : (
              rows.map((row) => <PermissionRow access={row.access} key={row.key} path={row.path} />)
            )}
          </PermissionList>

          <p className="text-sm leading-5 text-muted-foreground">{expiryLabel(app)}</p>

          <div className="flex flex-col gap-3">
            <Button className="w-full" onClick={close} size="lg" variant="outline">
              Done
            </Button>
            <Button
              className="w-full"
              onClick={() => setStep("confirm")}
              size="lg"
              variant="destructive"
            >
              Revoke access
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2 pr-10">
            <h2 className="text-xl font-bold leading-7" id="authorized-app-title">
              Revoke access?
            </h2>
            <p className="text-sm leading-5 text-muted-foreground" id="authorized-app-description">
              <bdi className="break-all font-medium text-foreground" dir="ltr">
                {app.clientId}
              </bdi>{" "}
              will no longer be able to access your data. You can authorize it again later.
            </p>
          </div>
          {failed ? (
            <FieldMessage error>Could not revoke access. Please try again.</FieldMessage>
          ) : null}
          <div className="flex flex-col gap-3">
            <Button
              className="w-full"
              disabled={pending}
              onClick={close}
              ref={cancelButton}
              size="lg"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="w-full"
              disabled={pending}
              onClick={() => {
                void revoke();
              }}
              size="lg"
              variant="destructive"
            >
              {pending ? "Revoking…" : "Revoke"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export { AUTHORIZED_APP_DIALOG_CLASS_NAME, AuthorizedAppDialog };
