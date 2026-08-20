"use client";

import type { AuthorizationRequestReview } from "../../../logic/authorization/PassportAuthorizationController";
import type { LocalIdentityMetadata } from "../../../logic/local-identity/localIdentityModels";
import { GoogleLogo } from "../../shared/brand/googleLogo";
import { CheckIcon, SquareUserRoundIcon, XIcon } from "../../shared/icons/actionIcons";
import { PassportScreen } from "../../shared/layout/passportScreen";
import { Avatar } from "../../shared/primitives/avatar";
import { Button } from "../../shared/primitives/button";
import { DisplayHeading } from "../../shared/primitives/typography";
import { PermissionList, PermissionRow } from "./permissionList";

function AuthorizationReview({ identity, onAuthorize, onCancel, onSwitch, phase, review }: {
  identity?: LocalIdentityMetadata;
  onAuthorize: () => void;
  onCancel: () => void;
  onSwitch: () => void;
  phase: "review" | "approving" | "completing";
  review: AuthorizationRequestReview;
}) {
  const callbackHost = review.callbackHost;
  const busy = phase !== "review";
  const hasBroadAccess = review.capabilities.some((capability) => capability.scope === "broad");
  const authorizationEffect = describeAuthorizationEffect(review.capabilities);
  const account = identity?.googleAccount;
  const identityName = account?.name ?? "Your Pubky";

  return (
    <PassportScreen>
      <div className="flex flex-1 flex-col gap-6">
        <DisplayHeading accent="request." aria-label="Review authorization request.">Review</DisplayHeading>
        <PermissionList>
          {review.capabilities.length === 0 ? (
            <p className="text-sm font-medium text-muted-foreground">No data permissions requested.</p>
          ) : review.capabilities.map((capability) => (
            <PermissionRow access={formatAccess(capability)} key={`${capability.path}:${capability.read}:${capability.write}`} path={capability.path} />
          ))}
        </PermissionList>
        {hasBroadAccess ? (
          <p className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm font-medium leading-5 text-foreground" role="alert">
            This request includes broad access that is not limited to one app namespace.
          </p>
        ) : null}
        <p className="rounded-2xl border border-border bg-card p-4 text-sm font-medium leading-5 text-muted-foreground">
          <strong className="font-bold text-foreground">Requester identity: not verified.</strong> Only continue if you started this request.
          {callbackHost ? <> If Passport sends you to a site afterward, it will use <strong className="break-all font-bold text-foreground"><bdi dir="ltr">{callbackHost}</bdi></strong>.</> : " No return destination was supplied; the result will remain in Passport."}
        </p>
        <section className="flex flex-col gap-2" aria-labelledby="authorization-identity-heading">
          <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-brand" id="authorization-identity-heading">Authorize as</h2>
          <div className="relative flex h-[72px] items-center gap-2 rounded-2xl bg-card p-4">
            {identity ? (
              <>
                <Avatar fallback={identityName} size="sm" {...(account?.pictureUrl ? { src: account.pictureUrl } : {})} />
                {account ? <span className="absolute left-[39px] top-[39px] flex size-4 items-center justify-center drop-shadow-xl"><GoogleLogo /></span> : null}
                <span className="min-w-0 flex-1">
                  <strong className="block truncate leading-6">{identityName}</strong>
                  <span className="block truncate text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">{shortPublicKey(identity.publicIdentity.publicKeyZ32)}</span>
                </span>
              </>
            ) : <span className="min-w-0 flex-1 text-sm font-medium text-muted-foreground">No local identity available</span>}
            <Button disabled={busy} onClick={onSwitch} size="sm" type="button" variant="secondary"><SquareUserRoundIcon />Switch</Button>
          </div>
        </section>
        <p className="text-sm font-medium leading-5 text-muted-foreground">
          Make sure you trust this service, app, or device before authorizing with your pubky. <strong className="font-bold text-foreground">{authorizationEffect}</strong>
          {review.authenticationMethod === "grant" ? " This approval creates an app-specific, revocable grant." : " This request uses deprecated cookie authentication."}
        </p>
        <div className="mt-auto flex flex-col gap-4 pt-6">
          <Button disabled={busy} onClick={onCancel} size="lg" type="button" variant="outline"><XIcon />Cancel</Button>
          <Button disabled={busy || !identity} onClick={onAuthorize} size="lg" type="button"><CheckIcon /><span aria-live="polite">{authorizationButtonLabel(phase)}</span></Button>
        </div>
      </div>
    </PassportScreen>
  );
}

function authorizationButtonLabel(phase: "review" | "approving" | "completing"): string {
  if (phase === "approving") return "Authorizing…";
  if (phase === "completing") return "Completing…";
  return "Authorize";
}

function describeAuthorizationEffect(
  capabilities: AuthorizationRequestReview["capabilities"],
): string {
  const canRead = capabilities.some((capability) => capability.read);
  const canWrite = capabilities.some((capability) => capability.write);

  if (canRead && canWrite) {
    return "Authorizing will allow the requester to read and write your data.";
  }
  if (canRead) return "Authorizing will allow the requester to read your data.";
  if (canWrite) return "Authorizing will allow the requester to create, change, and delete data.";
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
