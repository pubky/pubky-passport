import { Fragment, useLayoutEffect, useRef, useState } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import {
  identityProfile,
  type LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import { AppleLogo } from "@/client/ui/shared/brand/appleLogo";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { shortPublicKey } from "@/client/ui/shared/formatPublicKey";
import { CheckIcon, SettingsIcon, SquareUserRoundIcon, XIcon } from "@/client/ui/shared/icons";
import { IdentitySummary } from "@/client/ui/shared/identitySummary";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";
import { formatPermissionAccess, PermissionList, PermissionRow } from "./permissionList";

function AuthorizationReview({
  encryptionConsent,
  identity,
  onAuthorize,
  onCancel,
  onManage,
  onSwitch,
  phase,
  review,
}: {
  encryptionConsent?: {
    declinedPaths: readonly string[];
    onChange: (declinedPaths: readonly string[]) => void;
  };
  identity?: LocalIdentityMetadata | undefined;
  onAuthorize: (declinedEncryptionPaths: readonly string[]) => void;
  onCancel: () => void;
  onManage: () => void;
  onSwitch: () => void;
  phase: "review" | "preparing" | "granting" | "completing";
  review: AuthorizationRequestReview;
}) {
  const [localDeclinedPaths, setLocalDeclinedPaths] = useState<readonly string[]>([]);
  const declinedEncryptionPaths = encryptionConsent?.declinedPaths ?? localDeclinedPaths;
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
  const profile = identityProfile(identity);
  const identityName = profile.name ?? "Your Pubky";
  const providerBadge = identity?.googleAccount ? (
    <GoogleLogo />
  ) : identity?.appleAccount ? (
    <AppleLogo />
  ) : undefined;
  const requester = review.requesterName ?? review.callbackHost ?? "this service";
  // `spk`: the app chose the pubky. Approval uses that pubky or nothing, and the SDK signer
  // refuses any other key.
  const expectedSigner = review.expectedSigner;
  const isExpectedIdentity =
    expectedSigner !== undefined && identity?.publicIdentity.publicKeyZ32 === expectedSigner;
  const canAuthorize = identity !== undefined && (!expectedSigner || isExpectedIdentity);
  const appName = review.requesterName ?? review.callbackHost ?? "This app";

  const setEncryptionAllowed = (path: string, allowed: boolean) => {
    if (busy || approvalStarted.current) return;
    const next = allowed
      ? declinedEncryptionPaths.filter((other) => !scopeCoversPath(path, other))
      : encryptionPaths.filter(
          (other) => declinedEncryptionPaths.includes(other) || scopeCoversPath(other, path),
        );
    if (encryptionConsent) encryptionConsent.onChange(next);
    else setLocalDeclinedPaths(next);
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
        {expectedSigner && isExpectedIdentity ? (
          <div className="flex flex-col gap-1 rounded-2xl border border-brand/30 bg-brand/10 p-4 text-sm leading-5">
            <strong className="font-bold text-foreground">
              {profile.name
                ? `${appName} asked to sign in as ${profile.name} (${shortPublicKey(expectedSigner)})`
                : `${appName} asked to sign in as ${shortPublicKey(expectedSigner)}`}
            </strong>
            <span className="font-medium text-muted-foreground">
              The app chose this pubky. To use a different one, start a new sign-in from the app.
            </span>
          </div>
        ) : null}
        {expectedSigner && !isExpectedIdentity ? (
          <p
            className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm font-medium leading-5 text-foreground"
            role="alert"
          >
            This request is for {shortPublicKey(expectedSigner)}, which isn&apos;t in this Passport.
          </p>
        ) : null}
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
                  <PermissionRow
                    access={formatPermissionAccess(capability)}
                    path={capability.path}
                  />
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
          <div className="flex flex-col gap-4 rounded-2xl bg-card p-4">
            <div className="flex min-h-10 items-center gap-2">
              {identity ? (
                <IdentitySummary
                  avatarSrc={profile.pictureUrl ?? undefined}
                  badge={providerBadge}
                  detail={shortPublicKey(identity.publicIdentity.publicKeyZ32)}
                  detailClassName="uppercase"
                  name={identityName}
                />
              ) : (
                <span className="min-w-0 flex-1 text-sm font-medium text-muted-foreground">
                  No local identity available
                </span>
              )}
            </div>
            <div
              className={isExpectedIdentity ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}
            >
              <Button
                className="min-w-0"
                disabled={busy || !identity}
                onClick={onManage}
                size="sm"
                type="button"
                variant="secondary"
              >
                <SettingsIcon />
                Manage
              </Button>
              {isExpectedIdentity ? null : (
                <Button
                  className="min-w-0"
                  disabled={busy}
                  onClick={onSwitch}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <SquareUserRoundIcon />
                  Switch
                </Button>
              )}
            </div>
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
          className="mt-auto"
          confirm={
            <Button
              className="w-full"
              disabled={busy || !canAuthorize}
              onClick={() => {
                if (busy || approvalStarted.current || !canAuthorize) return;
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
    const container = requester?.parentElement ?? null;
    if (!requester || !container) return;

    const fit = () => {
      requester.style.removeProperty("font-size");
      requester.style.whiteSpace = "nowrap";

      const availableWidth = container.clientWidth;
      // With wrapping off, `scrollWidth` is the single-line text width.
      const requiredWidth = requester.scrollWidth;
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
    <bdi className="block break-words" ref={requesterRef}>
      {children}
    </bdi>
  );
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

export { AuthorizationReview };
