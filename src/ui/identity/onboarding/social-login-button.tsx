import type { ButtonProps } from "../../shared/primitives/button";
import { Button } from "../../shared/primitives/button";
import { AppleLogo } from "../../shared/brand/apple-logo";
import { GoogleLogo } from "../../shared/brand/google-logo";

const providerMark = { apple: <AppleLogo />, google: <GoogleLogo />, ring: "P" };

function SocialLoginButton({ children, provider, ...props }: ButtonProps & { provider: keyof typeof providerMark }) {
  return <Button size="lg" variant="secondary" {...props}><span aria-hidden="true" className="flex size-5 items-center justify-center font-bold">{providerMark[provider]}</span>{children}</Button>;
}



export { SocialLoginButton };
