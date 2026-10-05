/** Where a failure is announced: next to the field it concerns, or for the whole form. */
export type FlowError = { target: "password" | "file" | "form"; message: string };
/**
 * Which recovery file a check asks for, so its messages name the right one: the one this session
 * just downloaded, one saved on an earlier visit while making a backup, or any (`check`, on
 * Verify your backup).
 */
export type FileSource = "downloaded" | "earlier" | "check";

/**
 * Messages name the file asked for (just downloaded, saved on an earlier visit, or any) and, when
 * its name is known, the file itself. A password that does not open the file is most likely a
 * typo moments after it was chosen, so that comes first; a damaged file comes second.
 */
export function verificationError(code: string, source: FileSource, fileName?: string): FlowError {
  const named = fileName ? shortFileName(fileName) : undefined;
  switch (code) {
    case "backup_mismatch":
      return {
        target: "file",
        message: named
          ? `This file is for a different pubky. Pick ${named}.`
          : "This file is for a different pubky. Pick the recovery file of this pubky.",
      };
    case "invalid_backup": {
      const which = {
        downloaded: "the recovery file you just downloaded",
        earlier: "the recovery file you saved earlier",
        check: "your recovery file",
      }[source];
      return {
        target: "file",
        message: named ? `Select ${which}, ${named}.` : `Select ${which} (it ends in .pkarr).`,
      };
    }
    case "invalid_password":
    case "backup_decryption_failed":
      return {
        target: "password",
        message: `That password doesn’t open this file. Passwords are case-sensitive, so check for typos and caps lock. If it’s right, the file may be damaged: ${
          {
            downloaded: "download it again.",
            earlier: "make a new recovery file.",
            check: "download a new recovery file.",
          }[source]
        }`,
      };
    default:
      return { target: "form", message: "Passport could not verify the selected recovery file." };
  }
}

/** `pubky-<key>.pkarr` with the key cut to its ends, e.g. `pubky-1xgt9g…zwsqdy.pkarr`. */
export function shortFileName(fileName: string): string {
  const extension = fileName.endsWith(".pkarr") ? ".pkarr" : "";
  const base = fileName.slice(0, fileName.length - extension.length);
  return base.length > 24 ? `${base.slice(0, 12)}…${base.slice(-6)}${extension}` : fileName;
}
