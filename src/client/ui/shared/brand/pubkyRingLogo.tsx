import Image from "next/image";

import { cn } from "@/client/ui/shared/mergeClassNames";

function PubkyRingLogo({ className }: { className?: string }) {
  return (
    <Image
      alt="Pubky Ring"
      className={cn("h-[30px] w-[137px]", className)}
      height={40}
      priority
      src="/brand/pubky-ring-logo.svg"
      width={184}
    />
  );
}

export { PubkyRingLogo };
