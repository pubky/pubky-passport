import { Fragment, useLayoutEffect, useRef, useState } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { shortPublicKey } from "@/client/ui/shared/formatPublicKey";
import { CheckIcon, SquareUserRoundIcon, XIcon } from "@/client/ui/shared/icons";
import { IdentitySummary } from "@/client/ui/shared/identitySummary";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";
import { PermissionList, PermissionRow } from "./permissionList";

function AuthorizationReview({
  identity,
  onAuthorize,
  onCancel,
  onSwitch,
  phase,
  review,
}: {
  identity?: LocalIdentityMetadata | undefined;
  onAuthorize: (declinedEncryptionPaths: readonly string[]) => void;
  onCancel: () => void;
  onSwitch: () => void;
  phase: "review" | "preparing" | "granting" | "completing";
  review: AuthorizationRequestReview;
}) {
  const [declinedEncryptionPaths, setDeclinedEncryptionPaths] = useState<readonly string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const approvalStarted = useRef(false);
  const busy = phase !== "review" || submitted;
  const encryptionPaths = [
    ...new Set(
      review.capabilities.filter((capability) => capability.encrypt).map(({ path }) => path),
    ),
  ];
  const hasSelectedEncryption = encryptionPaths.some(
    (path) => !declinedEncryptionPaths.includes(path),
  );
  const hasOverlappingEncryption = encryptionPaths.some((path) =>
    encryptionPaths.some((other) => other !== path && scopeCoversPath(path, other)),
  );
  const hasBroadAccess = review.capabilities.some((capability) => capability.scope === "broad");
  const account = identity?.googleAccount;
  const identityName = account?.name ?? "Your Pubky";
  const requester = review.requesterName ?? review.callbackHost ?? "this service";

  const setEncryptionAllowed = (path: string, allowed: boolean) => {
    if (busy || approvalStarted.current) return;
    setDeclinedEncryptionPaths((declined) =>
      allowed
        ? declined.filter((other) => !scopeCoversPath(path, other))
        : encryptionPaths.filter(
            (other) => declined.includes(other) || scopeCoversPath(other, path),
          ),
    );
  };

  return (
    <PassportScreen>
      <div className="flex flex-1 flex-col gap-6">
        <DisplayHeading
          accent={<FittedRequester>{requester}</FittedRequester>}
          aria-label={`Sign in to ${requester}`}
        >
          Sign in to
        </DisplayHeading>
        {hasBroadAccess ? (
          <p
            className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm font-medium leading-5 text-foreground"
            role="alert"
          >
            This request includes broad access that is not limited to one app namespace.
          </p>
        ) : null}
        <PermissionList>
          {review.capabilities.length === 0 ? (
            <p className="text-sm font-medium text-muted-foreground">
              No data permissions requested.
            </p>
          ) : (
            review.capabilities.map((capability, index) => (
              <Fragment key={`${capability.path}:${index}`}>
                {capability.read || capability.write ? (
                  <PermissionRow access={formatAccess(capability)} path={capability.path} />
                ) : null}
                {capability.encrypt &&
                review.capabilities.findIndex(
                  (other) => other.encrypt && other.path === capability.path,
                ) === index ? (
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-brand/20 bg-brand/5 p-3 has-disabled:cursor-default has-disabled:opacity-60">
                    <input
                      aria-describedby="authorization-encryption-warning"
                      aria-label={`Encrypt and decrypt content ${capability.path}`}
                      checked={!declinedEncryptionPaths.includes(capability.path)}
                      className="mt-0.5 size-4 shrink-0 accent-brand"
                      disabled={busy}
                      onChange={(event) =>
                        setEncryptionAllowed(capability.path, event.currentTarget.checked)
                      }
                      type="checkbox"
                    />
                    <span className="min-w-0 text-sm font-medium leading-5">
                      <span className="block">Encrypt and decrypt content</span>
                      <bdi className="block break-all text-xs text-muted-foreground" dir="ltr">
                        {capability.path}
                      </bdi>
                    </span>
                  </label>
                ) : null}
              </Fragment>
            ))
          )}
          {encryptionPaths.length > 0 ? (
            <p
              className="text-sm leading-5 text-muted-foreground"
              id="authorization-encryption-warning"
            >
              Sharing an encryption key lets this service encrypt and decrypt content in that scope,
              including future content. Once shared, the key cannot be revoked.
            </p>
          ) : null}
          {hasOverlappingEncryption ? (
            <p className="text-sm leading-5 text-muted-foreground">
              A folder key also covers its contents. Declining a nested scope also declines any
              requested folder keys that cover it. Selecting a folder key selects its nested scopes.
            </p>
          ) : null}
        </PermissionList>
        <section className="flex flex-col gap-2" aria-labelledby="authorization-identity-heading">
          <h2 className="sr-only" id="authorization-identity-heading">
            Signing identity
          </h2>
          <div className="flex h-18 items-center gap-2 rounded-2xl bg-card p-4">
            {identity ? (
              <IdentitySummary
                avatarSrc={account?.pictureUrl ?? undefined}
                badge={account ? <GoogleLogo /> : undefined}
                detail={shortPublicKey(identity.publicIdentity.publicKeyZ32)}
                detailClassName="uppercase"
                name={identityName}
              />
            ) : (
              <span className="min-w-0 flex-1 text-sm font-medium text-muted-foreground">
                No local identity available
              </span>
            )}
            <Button disabled={busy} onClick={onSwitch} size="sm" type="button" variant="secondary">
              <SquareUserRoundIcon />
              Switch
            </Button>
          </div>
        </section>
        <p className="text-sm font-medium leading-5 text-muted-foreground opacity-80">
          Make sure you trust this service, browser, or device before authorizing with your pubky.{" "}
          <strong className="font-bold text-foreground">
            {describeAuthorizationEffect(
              review.capabilities,
              requester,
              encryptionPaths.length > 0,
              hasSelectedEncryption,
            )}
          </strong>
        </p>
        {phase === "granting" ? (
          <p aria-live="polite" className="text-sm font-medium leading-5 text-muted-foreground">
            The grant is being committed and can no longer be cancelled.
          </p>
        ) : null}
        <PassportNavigation
          back={
            <Button
              className="w-full"
              disabled={busy}
              onClick={onCancel}
              size="lg"
              type="button"
              variant="outline"
            >
              <XIcon />
              Cancel
            </Button>
          }
          className="mt-auto md:mt-0"
          confirm={
            <Button
              className="w-full"
              disabled={busy || !identity}
              onClick={() => {
                if (busy || approvalStarted.current || !identity) return;
                approvalStarted.current = true;
                setSubmitted(true);
                onAuthorize(
                  encryptionPaths.filter((path) => declinedEncryptionPaths.includes(path)),
                );
              }}
              size="lg"
              type="button"
            >
              <CheckIcon />
              <span aria-live="polite">{authorizationButtonLabel(phase)}</span>
            </Button>
          }
        />
      </div>
    </PassportScreen>
  );
}

const MINIMUM_REQUESTER_FONT_SIZE_PX = 32;

function FittedRequester({ children }: { children: string }) {
  const requesterRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const requester = requesterRef.current;
    const container = requester ? nearestBlockContainer(requester) : null;
    if (!requester || !container) return;

    const fit = () => {
      requester.style.removeProperty("font-size");
      requester.style.whiteSpace = "nowrap";

      const availableWidth = container.clientWidth;
      // `scrollWidth` is 0 while the requester itself is inline (desktop); the bounding box then
      // carries the single-line text width.
      const requiredWidth = Math.max(
        requester.scrollWidth,
        requester.getBoundingClientRect().width,
      );
      if (availableWidth <= 0 || requiredWidth <= availableWidth) return;

      const baseFontSize = Number.parseFloat(window.getComputedStyle(requester).fontSize);
      if (!Number.isFinite(baseFontSize)) return;

      const fittedFontSize = (baseFontSize * availableWidth) / requiredWidth;
      requester.style.fontSize = `${Math.max(MINIMUM_REQUESTER_FONT_SIZE_PX, fittedFontSize)}px`;
      if (fittedFontSize < MINIMUM_REQUESTER_FONT_SIZE_PX) requester.style.whiteSpace = "normal";
    };

    fit();

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(fit);
    resizeObserver?.observe(container);
    let active = true;
    void document.fonts?.ready.then(() => {
      if (active) fit();
    });

    return () => {
      active = false;
      resizeObserver?.disconnect();
    };
  }, [children]);

  return (
    <bdi className="block break-words md:inline" ref={requesterRef}>
      {children}
    </bdi>
  );
}

/**
 * The accent wrapper is `display: inline` on desktop, where `clientWidth` is always 0, so the
 * requester is fitted against the nearest block-level ancestor (the heading) instead.
 */
function nearestBlockContainer(element: HTMLElement): HTMLElement | null {
  let container = element.parentElement;
  while (container && window.getComputedStyle(container).display === "inline") {
    container = container.parentElement;
  }
  return container;
}

function authorizationButtonLabel(
  phase: "review" | "preparing" | "granting" | "completing",
): string {
  if (phase === "preparing") return "Preparing…";
  if (phase === "granting") return "Granting access…";
  if (phase === "completing") return "Completing…";
  return "Authorize";
}

function describeAuthorizationEffect(
  capabilities: AuthorizationRequestReview["capabilities"],
  requester: string,
  hasEncryptionRequest: boolean,
  hasSelectedEncryption: boolean,
): string {
  const canRead = capabilities.some((capability) => capability.read);
  const canWrite = capabilities.some((capability) => capability.write);

  const storageEffect =
    canRead && canWrite
      ? `Authorizing will allow ${requester} to read and update your data.`
      : canRead
        ? `Authorizing will allow ${requester} to read your data.`
        : canWrite
          ? `Authorizing will allow ${requester} to update your data.`
          : hasEncryptionRequest
            ? "This request does not ask for storage access."
            : "This request does not ask for data access.";

  if (hasSelectedEncryption) {
    return `${storageEffect} Authorizing will share encryption keys with ${requester} for the selected scopes.`;
  }
  if (hasEncryptionRequest) return `${storageEffect} No encryption keys will be shared.`;
  return storageEffect;
}

/** A directory key can derive every descendant's key; a file key covers only that file. */
function scopeCoversPath(scope: string, path: string): boolean {
  return scope === path || (scope.endsWith("/") && path.startsWith(scope));
}

function formatAccess(capability: AuthorizationRequestReview["capabilities"][number]): string {
  if (capability.read && capability.write) return "Read,write";
  if (capability.write) return "Write";
  return "Read";
}

export { AuthorizationReview };
