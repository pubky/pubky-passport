"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  bindGoogleCredentialCallback,
  googleIdTokenSubject,
  loadGoogleAccounts,
  releaseGoogleCredentialCallback,
  requestGoogleDriveAccess,
  type GoogleCredentialResponse,
  type GoogleIdentityProviderErrorCode,
} from "../browser/identity/google/googleIdentityProvider";
import { logger } from "../libs/logger/logger";

export function GoogleSignInButton({ clientId, disabled, onAuthorized }: {
  clientId: string;
  disabled: boolean;
  onAuthorized: (credential: string, driveAccessToken: string) => Promise<void>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const credential = useRef<string | null>(null);
  const subject = useRef<string | undefined>(undefined);
  const attempt = useRef(0);
  const driveAbortController = useRef<AbortController | null>(null);
  const [stage, setStage] = useState<"sign-in" | "drive" | "submitting">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reset = useCallback((message: string | null = null): void => {
    driveAbortController.current?.abort();
    driveAbortController.current = null;
    attempt.current += 1;
    credential.current = null;
    subject.current = undefined;
    setError(message);
    setStage("sign-in");
    setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    let boundCredentialCallback: ((response: GoogleCredentialResponse) => void) | null = null;
    const activeAttempt = attempt.current + 1;
    attempt.current = activeAttempt;
    void (async () => {
      if (disabled) return;
      const accounts = await loadGoogleAccounts();
      if (!mounted || Result.isError(accounts) || !container.current) {
        if (Result.isError(accounts)) {
          logger.warn("identity.google.button.unavailable", { code: accounts.error.code });
          if (mounted) setError("Google sign-in is unavailable. Try again.");
        }
        return;
      }

      boundCredentialCallback = (response) => {
        if (!mounted || attempt.current !== activeAttempt) return;
        if (typeof response.credential === "string" && response.credential.length > 0) {
          const googleSubject = googleIdTokenSubject(response.credential);
          if (!googleSubject) {
            reset("Google sign-in did not return an identity. Try again.");
            return;
          }
          credential.current = response.credential;
          subject.current = googleSubject;
          setError(null);
          setStage("drive");
        } else {
          logger.warn("identity.google.button.credential_failed");
          reset("Google sign-in did not return an identity. Try again.");
        }
      };
      const bound = bindGoogleCredentialCallback({
        accounts: accounts.value,
        clientId,
        callback: boundCredentialCallback,
      });
      if (Result.isError(bound)) {
        logger.warn("identity.google.button.initialize_failed", { code: bound.error.code });
        setError("Google sign-in is unavailable. Try again.");
        return;
      }
      container.current.replaceChildren();
      accounts.value.id.renderButton(container.current, { theme: "outline", size: "large", text: "continue_with" });
    })();

    return () => {
      mounted = false;
      if (boundCredentialCallback) releaseGoogleCredentialCallback(boundCredentialCallback);
      driveAbortController.current?.abort();
      driveAbortController.current = null;
      attempt.current += 1;
      credential.current = null;
      subject.current = undefined;
    };
  }, [clientId, disabled, reset, version]);

  async function requestDriveAccess(): Promise<void> {
    const googleIdToken = credential.current;
    const activeAttempt = attempt.current;
    if (!googleIdToken) {
      reset("Google sign-in did not return an identity. Try again.");
      return;
    }

    setStage("submitting");
    const abortController = new AbortController();
    driveAbortController.current?.abort();
    driveAbortController.current = abortController;
    let driveAccess;
    try {
      if (!subject.current) {
        reset("Google sign-in did not return an identity. Try again.");
        return;
      }
      driveAccess = await requestGoogleDriveAccess({
        clientId,
        loginHint: subject.current,
        expectedSubject: subject.current,
        signal: abortController.signal,
      });
    } catch {
      if (attempt.current !== activeAttempt) return;
      logger.warn("identity.google.button.drive_consent_failed", { code: "unexpected" });
      reset("Google Drive permission was not granted. Try again.");
      return;
    }
    if (driveAbortController.current === abortController) driveAbortController.current = null;
    if (attempt.current !== activeAttempt) return;
    if (Result.isError(driveAccess)) {
      logger.warn("identity.google.button.drive_consent_failed", { code: driveAccess.error.code });
      reset(messageForDriveFailure(driveAccess.error.code));
      return;
    }

    credential.current = null;
    subject.current = undefined;
    attempt.current += 1;
    const handoffAttempt = attempt.current;
    try {
      await onAuthorized(googleIdToken, driveAccess.value);
    } catch {
      if (attempt.current === handoffAttempt) logger.warn("identity.google.button.handoff_failed");
    } finally {
      if (attempt.current === handoffAttempt) reset();
    }
  }

  if (disabled || stage === "submitting") {
    return <p aria-live="polite" className="text-sm text-neutral-600" role="status">Connecting your Google identity.</p>;
  }

  if (stage === "drive") {
    return <button className="rounded border px-3 py-2" disabled={disabled} onClick={() => void requestDriveAccess()} type="button">Allow Drive access</button>;
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div ref={container} />
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
      {error ? <button className="rounded border px-3 py-2" onClick={() => reset()} type="button">Try again</button> : null}
    </div>
  );
}

function messageForDriveFailure(code: GoogleIdentityProviderErrorCode): string {
  switch (code) {
    case "drive_popup_closed":
      return "The Google Drive window was closed. Try again.";
    case "drive_popup_failed_to_open":
      return "The Google Drive window could not open. Check popup blocking and try again.";
    case "drive_consent_timeout":
      return "Google Drive permission timed out. Try again.";
    case "drive_account_mismatch":
      return "Choose the same Google account for sign-in and Drive, then try again.";
    case "drive_account_verification_failed":
      return "Google Drive account verification is unavailable. Check your connection and try again.";
    default:
      return "Google Drive permission was not granted. Try again.";
  }
}
