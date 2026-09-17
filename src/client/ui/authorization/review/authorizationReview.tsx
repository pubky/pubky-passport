import { useLayoutEffect, useRef } from "react";

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
  const requester = review.requesterName ?? review.callbackHost ?? "this service";

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
          className="mt-auto md:mt-0"
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
  if (capability.read && capability.write) return "Read,write";
  if (capability.write) return "Write";
  return "Read";
}

export { AuthorizationReview };
