"use client";

import Image from "next/image";

import { usePendingRequest } from "@/client/ui/shared/usePendingRequest";

function PassportLogo() {
  const requestPending = usePendingRequest();
  const image = (
    <Image
      alt="Pubky"
      className="h-9 w-auto"
      height={200}
      priority
      src="/brand/pubky.svg"
      width={606}
    />
  );
  // While a request waits the logo leads nowhere: following it would drop the app's request.
  if (requestPending) return <span className="inline-flex shrink-0">{image}</span>;
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages -- The logo must reload the document when returning home.
    <a className="inline-flex shrink-0 rounded-sm" href="/">
      {image}
    </a>
  );
}

export { PassportLogo };
