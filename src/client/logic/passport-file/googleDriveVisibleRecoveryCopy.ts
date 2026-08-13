import "client-only";

const VISIBLE_RECOVERY_FOLDER_NAME = "Pubky Passport";
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const PUBKY_PUBLIC_KEY_DISPLAY_PATTERN = /^pubky[ybndrfg8ejkmcpqxot1uwisza345h769]{51}[yo]$/;

function visibleRecoveryFileName(publicKeyDisplay: string): string | null {
  return PUBKY_PUBLIC_KEY_DISPLAY_PATTERN.test(publicKeyDisplay)
    ? `${publicKeyDisplay}.json`
    : null;
}

export {
  DRIVE_FOLDER_MIME_TYPE,
  VISIBLE_RECOVERY_FOLDER_NAME,
  visibleRecoveryFileName,
};
