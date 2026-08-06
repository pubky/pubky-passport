import type { ButtonProps } from "./button";
import { Button } from "./button";
import { GoogleLogo } from "./google-logo";

const providerMark = { apple: "●", google: <GoogleLogo />, ring: "P" };

function SocialLoginButton({ children, provider, ...props }: ButtonProps & { provider: keyof typeof providerMark }) {
  return <Button size="lg" variant="secondary" {...props}><span aria-hidden="true" className="flex size-5 items-center justify-center font-bold">{providerMark[provider]}</span>{children}</Button>;
}

export { SocialLoginButton };
