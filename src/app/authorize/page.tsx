import { AuthorizationWindow } from "@/client/ui/authorization/authorizationWindow";
import { AuthorizationFlow } from "@/client/ui/authorization/authorizationFlow";

export default function AuthorizePage() {
  return (
    <AuthorizationWindow>
      <AuthorizationFlow />
    </AuthorizationWindow>
  );
}
