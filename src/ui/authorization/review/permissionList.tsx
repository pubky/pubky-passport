import type { ReactNode } from "react";

import { FolderIcon } from "../../shared/icons/actionIcons";

function PermissionList({ children }: { children: ReactNode }) {
  return <section className="flex flex-col gap-2 rounded-[12px] border border-brand/32 p-4 shadow-xl"><h3 className="text-xs font-medium uppercase tracking-[0.1em] text-brand">Requested permissions</h3>{children}</section>;
}

function PermissionRow({ access, path }: { access: string; path: string }) {
  return <div className="flex items-center gap-2"><FolderIcon /><span className="min-w-0 flex-1 truncate text-sm font-medium">{path}</span><span className="text-xs font-medium uppercase tracking-[0.1em] text-brand">{access}</span></div>;
}

export { PermissionList, PermissionRow };
