import type { ButtonProps } from "../shared/primitives/button";
import { Button } from "../shared/primitives/button";
import { GoogleLogo } from "../shared/brand/googleLogo";

function GoogleSignInButton({ children, ...props }: ButtonProps) {
  return (
    <Button size="lg" variant="secondary" {...props}>
      <span aria-hidden="true" className="flex size-5 items-center justify-center font-bold">
        <GoogleLogo />
      </span>
      {children}
    </Button>
  );
}

export { GoogleSignInButton };
