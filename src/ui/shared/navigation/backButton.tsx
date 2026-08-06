import Image from "next/image";

import { Button } from "../primitives/button";

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button className="w-full" onClick={onClick} size="lg" type="button" variant="secondary">
      <span className="flex size-4 items-center justify-center">
        <Image alt="" height={10.6633} src="/icons/figma-arrow-left.svg" width={10.6633} />
      </span>
      Back
    </Button>
  );
}

export { BackButton };
