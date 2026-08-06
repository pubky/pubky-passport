import type { ReactNode } from "react";

import { PassportLogo } from "../components/passport-logo";

function AppHeader({ action }: { action?: ReactNode }) {
  return (
    <header className="flex h-[84px] w-full items-center justify-between px-6">
      <PassportLogo />
      {action}
    </header>
  );
}

export { AppHeader };
