import type { ReactNode } from "react";

import { FolderIcon } from "../../shared/icons";

function PermissionList({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-brand/32 p-[15px] shadow-xl">
      <h2 className="text-xs font-medium uppercase leading-5 tracking-[0.1em] text-brand">
        Requested permissions
      </h2>
      {children}
    </section>
  );
}

function PermissionRow({ access, path }: { access: string; path: string }) {
  return (
    <div className="flex min-h-5 items-center gap-2">
      <span className="flex size-5 shrink-0 items-center justify-center">
        <FolderIcon />
      </span>
      <bdi className="min-w-0 flex-1 break-all text-sm font-medium leading-5" dir="ltr">
        {path}
      </bdi>
      <span className="shrink-0 text-xs font-medium uppercase leading-4 tracking-[0.1em] text-brand">
        {access}
      </span>
    </div>
  );
}

export { PermissionList, PermissionRow };
