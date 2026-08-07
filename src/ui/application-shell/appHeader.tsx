import type { ReactNode } from "react";

import { PassportLogo } from "../shared/brand/passportLogo";

function AppHeader({ action }: { action?: ReactNode }) {
  return (
    <header className="flex h-[84px] w-full items-center justify-between bg-[linear-gradient(180deg,rgba(5,5,10,0.96),rgba(5,5,10,0))] px-6">
      <PassportLogo />
      {action}
    </header>
  );
}

export { AppHeader };
