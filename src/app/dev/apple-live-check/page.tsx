import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppleLiveCheck } from "@/client/ui/dev/appleLiveCheck";
import { isAppleLiveCheckEnabled } from "@/server/environment";

export const metadata: Metadata = { title: "Apple live check", robots: { index: false } };

/** Development check against a real Apple setup. 404 unless APPLE_LIVE_CHECK=true. */
export default function AppleLiveCheckPage() {
  if (!isAppleLiveCheckEnabled()) notFound();
  return <AppleLiveCheck />;
}
