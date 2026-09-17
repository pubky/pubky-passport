import type { ButtonProps } from "@/client/ui/shared/primitives/button";
import { Button } from "@/client/ui/shared/primitives/button";
import { AppleLogo } from "@/client/ui/shared/brand/appleLogo";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";

const providerMark = { apple: <AppleLogo />, google: <GoogleLogo />, ring: "P" };

function ProviderSignInButton({
  children,
  provider,
  ...props
}: ButtonProps & { provider: keyof typeof providerMark }) {
  return (
    <Button size="lg" variant="secondary" {...props}>
      <span aria-hidden="true" className="flex size-5 items-center justify-center font-bold">
        {providerMark[provider]}
      </span>
      {children}
    </Button>
  );
}

export { ProviderSignInButton };
