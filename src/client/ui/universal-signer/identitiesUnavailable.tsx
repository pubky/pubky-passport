import { useState } from "react";

import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import type { AuthorizationController } from "@/client/ui/authorization/usePassportAuthorization";
import type { LocalIdentityErrorCode } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { IdentityCatalogUnavailableReason } from "@/client/ui/identity-catalog/useIdentityCatalog";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { CancelButton } from "@/client/ui/shared/cancelButton";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { RotateCcwIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";
import { RingSignIn } from "./ringSignIn";
import { useRingRequestLauncher } from "./useRingRequestLauncher";

const CAUSES = {
  storage_blocked: {
    cause:
      "Your browser is blocking Passport's storage. This happens in private windows or when site data is turned off for this site.",
    nextStep: "Allow site data for this site, then try again.",
    nextStepInRequest:
      "Continue with Pubky Ring instead, or cancel this sign-in, allow site data for this site and start again in the app.",
  },
  unreadable_store: {
    cause: "Passport's saved data in this browser can't be read.",
    nextStep:
      "Try again. If it keeps happening, restore your identity from its recovery file in another browser.",
    nextStepInRequest: "Continue with Pubky Ring instead, or cancel this sign-in.",
  },
} as const;

/**
 * Saved identities cannot be read, and why: `reason` picks the explanation, and the repository's
 * own `code` goes under Technical details for support. Without a request, Try again reloads once
 * the cause is fixed. During a request the app waits: Cancel answers it, and Pubky Ring can still
 * approve it, since handing the request to Ring needs no storage in this browser.
 */
export function IdentitiesUnavailable({
  authorization,
  code,
  controller,
  reason,
}: {
  authorization: PassportAuthorizationViewState;
  code: LocalIdentityErrorCode;
  controller: AuthorizationController;
  reason: IdentityCatalogUnavailableReason;
}) {
  const [launcher, launchRing] = useRingRequestLauncher(controller);
  const [withRing, setWithRing] = useState(false);
  const inRequest = authorization.status === "review";
  if (inRequest && withRing)
    return (
      <RingSignIn
        getAuthorizationUrl={() => controller.externalSignerUrl()}
        launcher={launcher}
        onApproved={() => void controller.finishExternalApproval()}
        onBack={() => {
          launcher.reset();
          setWithRing(false);
        }}
        review={authorization.review}
        watchApproval={
          controller.canWatchExternalApproval()
            ? () => controller.watchExternalApproval()
            : undefined
        }
      />
    );
  const { cause, nextStep, nextStepInRequest } = CAUSES[reason];
  return (
    <ErrorScreen
      accent="unavailable."
      action={
        inRequest ? (
          <Button
            className="w-full"
            onClick={() => {
              launchRing();
              setWithRing(true);
            }}
            size="lg"
            variant="secondary"
          >
            <PubkyBrandIcon />
            Continue with Pubky Ring
          </Button>
        ) : (
          <Button className="w-full" onClick={() => window.location.replace("/")} size="lg">
            <RotateCcwIcon />
            Try again
          </Button>
        )
      }
      back={inRequest ? <CancelButton onClick={() => void controller.cancel()} /> : undefined}
      cause={cause}
      details={{ code }}
      nextStep={inRequest ? nextStepInRequest : nextStep}
      title="Identities"
    />
  );
}
