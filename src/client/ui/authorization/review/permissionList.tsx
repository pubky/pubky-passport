import type { ReactNode } from "react";

import { FolderIcon } from "../../shared/icons/actionIcons";

function PermissionList({ children }: { children: ReactNode }) {
  return <section className="flex flex-col gap-2 rounded-[12px] border border-brand/32 p-4 shadow-xl"><h2 className="text-xs font-medium uppercase tracking-[0.1em] text-brand">Requested permissions</h2>{children}</section>;
}

function PermissionRow({ access, path }: { access: string; path: string }) {
  return <div className="flex items-start gap-2"><span className="shrink-0"><FolderIcon /></span><bdi className="min-w-0 flex-1 break-all text-sm font-medium" dir="ltr">{path}</bdi><span className="shrink-0 text-xs font-medium uppercase tracking-[0.1em] text-brand">{access}</span></div>;
}

export { PermissionList, PermissionRow };
