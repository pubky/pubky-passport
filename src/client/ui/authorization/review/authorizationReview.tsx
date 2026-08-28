import { useLayoutEffect, useRef } from "react";

import type { AuthorizationRequestReview } from "../../../logic/authorization/flow/PassportAuthorizationController";
import type { LocalIdentityMetadata } from "../../../logic/local-identity/localIdentityModels";
import { GoogleLogo } from "../../shared/brand/googleLogo";
import { CheckIcon, SquareUserRoundIcon, XIcon } from "../../shared/actionIcons";
import { PassportNavigation } from "../../shared/passportNavigation";
import { PassportScreen } from "../../shared/passportScreen";
import { Avatar } from "../../shared/primitives/avatar";
import { Button } from "../../shared/primitives/button";
import { DisplayHeading } from "../../shared/primitives/typography";
import { PermissionList, PermissionRow } from "./permissionList";

function AuthorizationReview({
  identity,
  onAuthorize,
  onCancel,
  onSwitch,
  phase,
  review,
}: {
  identity?: LocalIdentityMetadata;
  onAuthorize: () => void;
  onCancel: () => void;
  onSwitch: () => void;
  phase: "review" | "preparing" | "granting" | "completing";
  review: AuthorizationRequestReview;
}) {
  const busy = phase !== "review";
  const hasBroadAccess = review.capabilities.some((capability) => capability.scope === "broad");
  const account = identity?.googleAccount;
  const identityName = account?.name ?? "Your Pubky";
  const requester = review.callbackHost ?? "this service";

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
              <PermissionRow
                access={formatAccess(capability)}
                key={`${capability.path}:${capability.read}:${capability.write}:${index}`}
                path={capability.path}
              />
            ))
          )}
        </PermissionList>
        <section className="flex flex-col gap-2" aria-labelledby="authorization-identity-heading">
          <h2 className="sr-only" id="authorization-identity-heading">
            Signing identity
          </h2>
          <div className="relative flex h-[72px] items-center gap-2 rounded-2xl bg-card p-4">
            {identity ? (
              <>
                <Avatar
                  fallback={identityName}
                  size="sm"
                  {...(account?.pictureUrl ? { src: account.pictureUrl } : {})}
                />
                {account ? (
                  <span className="absolute left-[39px] top-[39px] flex size-4 items-center justify-center drop-shadow-xl">
                    <GoogleLogo />
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <strong className="block truncate leading-6">{identityName}</strong>
                  <span className="block truncate text-xs font-medium normal-case tracking-[0.1em] text-muted-foreground">
                    {shortPublicKey(identity.publicIdentity.publicKeyZ32)}
                  </span>
                </span>
              </>
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
            {describeAuthorizationEffect(review.capabilities, requester)}
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
          className="pt-6"
          confirm={
            <Button
              className="w-full"
              disabled={busy || !identity}
              onClick={onAuthorize}
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
    const container = requester?.parentElement;
    if (!requester || !container) return;

    const fit = () => {
      requester.style.removeProperty("font-size");
      requester.style.whiteSpace = "nowrap";

      const availableWidth = container.clientWidth;
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
    <bdi className="block break-words md:inline" ref={requesterRef}>
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
): string {
  const canRead = capabilities.some((capability) => capability.read);
  const canWrite = capabilities.some((capability) => capability.write);

  if (canRead && canWrite) {
    return `Authorizing will allow ${requester} to read and update your data.`;
  }
  if (canRead) return `Authorizing will allow ${requester} to read your data.`;
  if (canWrite) return `Authorizing will allow ${requester} to update your data.`;
  return "This request does not ask for data access.";
}

function formatAccess(capability: AuthorizationRequestReview["capabilities"][number]): string {
  if (capability.read && capability.write) return "Read & write";
  if (capability.write) return "Write";
  return "Read";
}

function shortPublicKey(publicKey: string): string {
  return publicKey.length > 12 ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}` : publicKey;
}

export { AuthorizationReview };
