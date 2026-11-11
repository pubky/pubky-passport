import Image from "next/image";
import type { CSSProperties } from "react";

/** Official gradient G, unchanged from Google's current branding-guidelines artwork. */
function GoogleButtonLogo({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={className}
      style={style}
      src="/brand/google-sign-in-g.png"
      width={200}
      height={200}
      unoptimized
    />
  );
}

export { GoogleButtonLogo };
