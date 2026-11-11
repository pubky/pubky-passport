import Image from "next/image";

import { cn } from "@/client/ui/shared/mergeClassNames";

function BrandEndorsement({ className }: { className?: string }) {
  return (
    <Image
      alt="Synonym, a Tether company"
      className={cn("shrink-0", className)}
      height={24}
      src="/brand/brand-endorsement.svg"
      width={215}
    />
  );
}

export { BrandEndorsement };
