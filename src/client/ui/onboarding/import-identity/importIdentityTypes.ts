import type {
  LocalIdentityImport,
  LocalIdentityImportResult,
  LocalIdentityImportSource,
} from "@/client/logic/local-identity/LocalIdentityController";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";

export type ImportIdentity = (
  source: LocalIdentityImportSource,
  onKeyRecovered?: (publicIdentity: PubkyPublicIdentity) => void,
) => Promise<LocalIdentityImportResult>;

export type ImportedIdentityHandler = (imported: LocalIdentityImport) => void;
