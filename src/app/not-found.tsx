import type { Metadata } from "next";

import { NotFoundScreen } from "@/client/ui/notFoundScreen";

export const metadata: Metadata = {
  title: "Page not found | Pubky Passport",
};

export default function NotFound() {
  return <NotFoundScreen />;
}
