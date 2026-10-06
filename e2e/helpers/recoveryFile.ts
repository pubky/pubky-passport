import { Keypair } from "@synonymdev/pubky";

import { PROFILE_KEY } from "./pubkyProfile";

/** The password `recoveryFile` encrypts with unless given another. */
export const RECOVERY_FILE_PASSWORD = "correct horse battery";

/** A real SDK recovery file for `PROFILE_KEY`, built the way other Pubky tools build them. */
export function recoveryFile(passphrase = RECOVERY_FILE_PASSWORD) {
  const keypair = Keypair.fromSecret(new Uint8Array(32).fill(1));
  try {
    return {
      name: `pubky-${PROFILE_KEY}.pkarr`,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(keypair.createRecoveryFile(passphrase)),
    };
  } finally {
    keypair.free();
  }
}
