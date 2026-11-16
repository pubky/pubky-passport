import type { LocalIdentityImportErrorCode } from "@/client/logic/local-identity/LocalIdentityController";

/** What the person reads when an import fails. Never includes words, passwords or file content. */
function importErrorMessage(code: LocalIdentityImportErrorCode): string {
  switch (code) {
    case "invalid_recovery_file":
      return "This file is not a recovery file. Please select a .pkarr file.";
    case "recovery_file_undecryptable":
      return "Wrong password or damaged file. Please check your password and try again.";
    case "invalid_recovery_phrase":
      return "This recovery phrase is not valid. Check the words and their order.";
    case "homeserver_not_found":
      return "This pubky has no homeserver, so Passport cannot sign in with it. Nothing was saved.";
    case "homeserver_unreachable":
      return "Could not connect. Check your connection and try again.";
    case "storage_unavailable":
      return "Your browser could not save this pubky. Check your browser's storage settings and try again.";
    case "signin_failed":
      return "Could not sign in to this pubky's homeserver. Nothing was saved.";
    case "import_failed":
      return "Could not sign in. Please try again.";
  }
}

export { importErrorMessage };
