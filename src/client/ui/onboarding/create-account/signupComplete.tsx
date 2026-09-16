import { useEffect, useState } from "react";

import type { HomeserverSignupDetails } from "@/client/logic/homegate/homegateSignup";
import { handoffSignupInvite, signupCallbackUrl } from "@/client/logic/signup/signupInviteHandoff";
import type { SignupRequest } from "@/client/logic/signup/signupRequest";
import { ButtonLink } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { SignupStep } from "./signupStep";

export function SignupComplete({
  request,
  invite,
}: {
  request: SignupRequest;
  invite: HomeserverSignupDetails;
}) {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void handoffSignupInvite(window, request, invite, controller.signal).then(
      (status) => {
        if (!controller.signal.aborted && status === "unavailable") setUnavailable(true);
      },
      () => {
        if (!controller.signal.aborted) setUnavailable(true);
      },
    );
    return () => controller.abort();
  }, [request, invite]);
  return (
    <SignupStep
      title="You’re ready"
      accent="to continue."
      description={
        <>
          Returning to{" "}
          <span className="break-all font-medium text-foreground">{request.clientOrigin}</span> to
          finish creating your account in Pubky Ring.
        </>
      }
    >
      <p role="status">
        Your verification is complete. Your app will open Pubky Ring or show a QR code for you to
        scan.
      </p>
      {unavailable ? (
        <FieldMessage error>
          We couldn’t return automatically. Use the button below to continue.
        </FieldMessage>
      ) : null}
      <ButtonLink href={signupCallbackUrl(request, invite)} referrerPolicy="no-referrer" size="lg">
        Return to app
      </ButtonLink>
    </SignupStep>
  );
}
