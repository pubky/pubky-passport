"use client";

import { toast } from "sonner";

import type { LocalIdentityBackupCheckResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { RingBackupVerifierPort } from "@/client/ui/passportCollaborators";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";
import { RecoveryFileCheck } from "./recoveryFileCheck";
import { RingBackupCheck } from "./ringBackupCheck";

/**
 * Verify your backup: both checks that a backup of this browser key brings it back, on one page
 * with no step before them. A recovery file opened with its password (left), and Pubky Ring
 * signing in with the key (right; at once on a computer, from its button on a phone); stacked
 * below 768px, the file first. Each card says its own failures; a check that passes is said with
 * a toast and the page goes on by itself, to `onDone` (by default where Back leads).
 *
 * `skippable` is set where the page is a step of its own, after the key export: Skip for now
 * leads to `onDone` too.
 */
export function VerifyBackupPage({
  identity,
  onBack,
  onDone = onBack,
  onFileVerified,
  onRingVerified,
  skippable = false,
  verifier,
  verifyRecoveryFile,
}: {
  identity: LocalIdentityMetadata;
  onBack: () => void;
  /** Where the page goes once a check passed, and from Skip for now. */
  onDone?: (() => void) | undefined;
  /** Told when a recovery file opened with its password, before the page goes on. */
  onFileVerified?: (() => void) | undefined;
  /** Told when Pubky Ring signed with this key, before the page goes on. */
  onRingVerified?: ((at: Date) => void) | undefined;
  skippable?: boolean;
  verifier: RingBackupVerifierPort;
  verifyRecoveryFile: (
    publicKeyZ32: string,
    recoveryFile: Uint8Array,
    password: string,
  ) => Promise<LocalIdentityBackupCheckResult>;
}) {
  return (
    <PassportScreen className="gap-4 md:pb-6">
      <DisplayHeading accent="backup." aria-label="Verify your backup." className="[&>span]:inline">
        Verify your{" "}
      </DisplayHeading>
      <div className="grid min-w-0 gap-5 md:grid-cols-2">
        <RecoveryFileCheck
          identity={identity}
          onVerified={() => {
            onFileVerified?.();
            toast.success("Recovery file verified");
            onDone();
          }}
          verifyRecoveryFile={verifyRecoveryFile}
        />
        <RingBackupCheck
          identity={identity}
          onVerified={(at) => {
            onRingVerified?.(at);
            toast.success("Verified in Pubky Ring");
            onDone();
          }}
          verifier={verifier}
        />
      </div>
      <PassportNavigation
        back={<BackButton onClick={onBack} />}
        tertiary={
          skippable ? (
            <Button onClick={onDone} type="button" variant="link">
              Skip for now
            </Button>
          ) : undefined
        }
      />
    </PassportScreen>
  );
}
