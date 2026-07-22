"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearGoogleAuthorization,
  googleIdTokenSubject,
  loadGoogleAccounts,
  requestGoogleDriveAccess,
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
  const [stage, setStage] = useState<"sign-in" | "drive" | "submitting">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reset = useCallback((message: string | null = null): void => {
    clearGoogleAuthorization();
    attempt.current += 1;
    credential.current = null;
    subject.current = undefined;
    setError(message);
    setStage("sign-in");
    setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    const activeAttempt = attempt.current + 1;
    attempt.current = activeAttempt;
    void (async () => {
      if (disabled) return;
      const accounts = await loadGoogleAccounts();
      if (!mounted || Result.isError(accounts) || !container.current) {
        if (Result.isError(accounts)) {
          logger.warn("identity.google.button.unavailable", { code: accounts.error.code });
          setError("Google sign-in is unavailable. Try again.");
        }
        return;
      }

      accounts.value.id.initialize({
        client_id: clientId,
        auto_select: false,
        callback(response) {
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
            if (mounted) reset("Google sign-in did not return an identity. Try again.");
          }
        },
      });
      container.current.replaceChildren();
      accounts.value.id.renderButton(container.current, { theme: "outline", size: "large", text: "continue_with" });
    })();

    return () => {
      mounted = false;
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
    let driveAccess;
    try {
      if (!subject.current) {
        reset("Google sign-in did not return an identity. Try again.");
        return;
      }
      driveAccess = await requestGoogleDriveAccess({ clientId, hint: subject.current, expectedSubject: subject.current });
    } catch {
      logger.warn("identity.google.button.drive_consent_failed", { code: "unexpected" });
      reset("Google Drive permission was not granted. Try again.");
      return;
    }
    if (attempt.current !== activeAttempt) return;
    if (Result.isError(driveAccess)) {
      logger.warn("identity.google.button.drive_consent_failed", { code: driveAccess.error.code });
      reset("Google Drive permission was not granted. Try again.");
      return;
    }

    credential.current = null;
    subject.current = undefined;
    attempt.current += 1;
    try {
      await onAuthorized(googleIdToken, driveAccess.value);
    } catch {
      logger.warn("identity.google.button.handoff_failed");
    } finally {
      reset();
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
