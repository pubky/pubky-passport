"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import {
  ICloudConnection,
  type CloudKitDatabase,
} from "@/client/logic/apple-identity/ICloudConnection";
import {
  SignInWithApple,
  type AppleIdentityCredentials,
} from "@/client/logic/apple-identity/SignInWithApple";
import {
  appleSubjectHash,
  ICloudPassportFileStore,
  PASSPORT_FILE_RECORD_TYPE,
} from "@/client/logic/passport-file/icloud/ICloudPassportFileStore";
import { WrappingKeyApiClient } from "@/client/logic/wrapping-key/WrappingKeyApiClient";
import { useAppleIdentityConfiguration } from "@/client/ui/appleIdentityConfiguration";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

const LIVE_CHECK_RECORD_NAME = "pubky-passport-live-check";
const MATRIX = [
  "Safari, Chrome and Firefox on macOS",
  "Safari and Chrome on iOS",
  "Passport opened from the Pubky iOS app (SFSafariViewController or ASWebAuthenticationSession): both popups open and return",
  "First authorization of the Services ID (name and email returned), then a second sign-in (email only)",
  "Chrome in a normal (not private) window",
  "An Apple Account with Advanced Data Protection",
  "An Apple Account with full iCloud storage, and one with iCloud turned off",
  "Different Apple Accounts in the two windows (expect an account mismatch in the real flow)",
];

type Line = { step: string; ok: boolean; detail: string };

/**
 * Walks through the real Apple setup step by step and reports what happened. It never shows
 * the Apple ID token, the wrapping key or the CloudKit session; only pass or fail and safe
 * metadata. It writes and deletes its own test record, not the Passport record.
 */
function AppleLiveCheck() {
  const apple = useAppleIdentityConfiguration();
  const [lines, setLines] = useState<Line[]>([]);
  const credentials = useRef<AppleIdentityCredentials | undefined>(undefined);
  const database = useRef<CloudKitDatabase | undefined>(undefined);
  const [signIn] = useState(() =>
    apple ? new SignInWithApple(apple.servicesId, `${globalThis.location?.origin}/`) : undefined,
  );
  const [icloud] = useState(() =>
    apple
      ? new ICloudConnection({
          containerId: apple.cloudKitContainerId,
          apiToken: apple.cloudKitApiToken,
          environment: apple.cloudKitEnvironment,
        })
      : undefined,
  );

  useEffect(() => () => icloud?.dispose(), [icloud]);

  if (!apple || !signIn || !icloud) return null;

  const log = (step: string, ok: boolean, detail: string) =>
    setLines((current) => [...current, { step, ok, detail }]);

  function signInWithApple() {
    void signIn?.signIn().then(async (result) => {
      if (Result.isError(result)) return log("Sign in with Apple", false, result.error.code);
      credentials.current = result.value;
      const hash = await appleSubjectHash(result.value.appleSubject);
      log(
        "Sign in with Apple",
        true,
        `state, nonce, iss, aud and exp checked; subject hash ${hash.slice(0, 12)}…; email ${result.value.email ? "returned" : "missing"}; name ${result.value.name ? "returned" : "missing"}; expires ${new Date(result.value.expiresAt).toISOString()}`,
      );
      const prepared = await icloud?.prepare();
      log(
        "Load CloudKit",
        Boolean(prepared && Result.isOk(prepared)),
        prepared && Result.isError(prepared) ? prepared.error.code : "ready",
      );
    });
  }

  async function wrappingKey() {
    const token = credentials.current?.appleIdToken;
    if (!token) return log("Wrapping key", false, "sign in first");
    const result = await new WrappingKeyApiClient(
      globalThis.fetch.bind(globalThis),
      "apple",
    ).requestWrappingKey(token);
    log(
      "Wrapping key",
      Result.isOk(result),
      Result.isOk(result)
        ? `issued for key ID ${result.value.keyId}`
        : `${result.error.code} (HTTP ${result.error.httpStatus ?? "-"})`,
    );
  }

  function connectICloud() {
    void icloud?.connect().then((result) => {
      if (Result.isError(result)) return log("Connect iCloud", false, result.error.code);
      database.current = result.value;
      log(
        "Connect iCloud",
        true,
        `signed in; cookies on this origin: ${document.cookie ? "PRESENT" : "none"}`,
      );
    });
  }

  async function recordRoundTrip() {
    const db = database.current;
    const subject = credentials.current?.appleSubject;
    if (!db || !subject) return log("Record round trip", false, "connect iCloud first");
    try {
      const created = await db
        .newRecordsBatch()
        .create({
          recordType: PASSPORT_FILE_RECORD_TYPE,
          recordName: LIVE_CHECK_RECORD_NAME,
          fields: {
            envelope: { value: "live-check" },
            appleSub: { value: await appleSubjectHash(subject) },
          },
        })
        .commit();
      log("Create test record", !created.errors?.length, JSON.stringify(created.errors ?? []));
      const fetched = await db.fetchRecords([LIVE_CHECK_RECORD_NAME]);
      const record = fetched.records?.[0];
      log(
        "Read test record",
        typeof record?.recordChangeTag === "string",
        String(record?.serverErrorCode ?? "found"),
      );
      if (typeof record?.recordChangeTag === "string") {
        const deleted = await db
          .newRecordsBatch()
          .delete({ recordName: LIVE_CHECK_RECORD_NAME, recordChangeTag: record.recordChangeTag })
          .commit();
        log("Delete test record", !deleted.errors?.length, JSON.stringify(deleted.errors ?? []));
      }
      const passportFile = await new ICloudPassportFileStore(
        db,
        subject,
        globalThis.location.origin,
      ).readPassportFile();
      log(
        "Read Passport record (read only)",
        Result.isOk(passportFile),
        Result.isOk(passportFile) ? passportFile.value.status : passportFile.error.code,
      );
    } catch (e) {
      log("Record round trip", false, e instanceof Error ? e.name : "error");
    }
  }

  return (
    <PassportScreen className="gap-6">
      <DisplayHeading accent="check." aria-label="Apple live check.">
        Apple live{" "}
      </DisplayHeading>
      <LeadText>
        Runs the real Apple steps on this origin. Each button needs its own click because each opens
        a popup.
      </LeadText>
      <div className="flex flex-wrap gap-3">
        <Button onClick={signInWithApple}>1. Sign in with Apple</Button>
        <Button onClick={() => void wrappingKey()}>2. Wrapping key</Button>
        <Button onClick={connectICloud}>3. Connect iCloud</Button>
        <Button onClick={() => void recordRoundTrip()}>4. Record round trip</Button>
      </div>
      <ol className="flex flex-col gap-2 text-sm" aria-label="Results">
        {lines.map((line, index) => (
          <li key={index}>
            <strong className={line.ok ? "text-brand" : "text-destructive-foreground"}>
              {line.ok ? "PASS" : "FAIL"}
            </strong>{" "}
            {line.step}: {line.detail}
          </li>
        ))}
      </ol>
      <section className="text-sm text-muted-foreground">
        <p className="mb-2 font-bold">Run in:</p>
        <ul className="list-disc pl-5">
          {MATRIX.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </section>
    </PassportScreen>
  );
}

export { AppleLiveCheck };
