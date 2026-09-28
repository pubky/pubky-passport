import { UniversalSignerFlow } from "@/client/ui/universal-signer/universalSignerFlow";

/** The v1 request entry (`/authorize#d=…`); `/` renders the same signer and forwards requests here. */
export default function AuthorizePage() {
  return <UniversalSignerFlow />;
}
