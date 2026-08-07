import type { ReactNode } from "react";

import { cn } from "../mergeClassNames";

type IconProps = { className?: string; size?: 16 | 20 };

function Glyph({ children, className, height, size = 16, viewBox, width }: IconProps & {
  children: ReactNode;
  height: number;
  viewBox: string;
  width: number;
}) {
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center", size === 20 ? "size-5" : "size-4", className)}>
      <svg fill="none" style={{ height, width }} viewBox={viewBox}>{children}</svg>
    </span>
  );
}

function ArrowLeftIcon(props: IconProps) {
  return <Glyph height={10.6633} viewBox="0 0 10.6633 10.6633" width={10.6633} {...props}><path d="M5.33167.665.665 5.33167l4.66667 4.66666M.665 5.33167h9.33333" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33" /></Glyph>;
}

function ArrowRightIcon(props: IconProps) {
  return <Glyph height={10.6633} viewBox="0 0 10.6633 10.6633" width={10.6633} {...props}><path d="M.665 5.33167h9.33333M5.33167 9.99833l4.66666-4.66666L5.33167.665" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33" /></Glyph>;
}

function CheckIcon(props: IconProps) {
  return <Glyph height={8.66333} viewBox="0 0 11.9967 8.66333" width={11.9967} {...props}><path d="m11.3317.665-7.33337 7.33333L.665 4.665" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33" /></Glyph>;
}

function CopyIcon(props: IconProps) {
  return <Glyph height={props.size ?? 16} viewBox="0 0 21.5 21.5" width={props.size ?? 16} {...props}><path d="M2.75 14.75a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2m-6 4h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></Glyph>;
}

function DownloadBackupIcon(props: IconProps) {
  return <Glyph height={13.33} viewBox="0 0 13.33 13.33" width={13.33} {...props}><path d="M12.665 8.665v2.6667a1.3333 1.3333 0 0 1-1.3333 1.3333H1.99833A1.3333 1.3333 0 0 1 .665 11.3317V8.665m9.33333-3.33333L6.665 8.665 3.33167 5.33167M6.665 8.665v-8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33" /></Glyph>;
}

function DownloadIcon(props: IconProps) {
  return <Glyph height={16} viewBox="0 0 19.5 19.5" width={16} {...props}><path d="M18.75 12.75v4a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2v-4m14-5-5 5-5-5m5 5v-12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></Glyph>;
}

function KeyRoundIcon(props: IconProps) {
  return <Glyph height={16} viewBox="0 0 21.5382 21.5382" width={16} {...props}><path d="M15.25 6.78833a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z" fill="currentColor" /><path d="M.75 16.7882v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4l-7.4 7.4Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><path d="M15.25 6.78833a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></Glyph>;
}

function LinkOffIcon(props: IconProps) {
  return <Glyph height={16} viewBox="0 0 21.5 21.5" width={16} {...props}><path d="M7.75 15.75h-2a5 5 0 0 1 0-10m8 0h2a5 5 0 0 1 4 8m-13-3h4m-10-10 20 20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></Glyph>;
}

function ScanIcon(props: IconProps) {
  return <Glyph height={13.33} viewBox="0 0 13.33 13.33" width={13.33} {...props}><path d="M.665 3.33167V1.99833A1.33333 1.33333 0 0 1 1.99833.665h1.33334M9.99833.665h1.33337a1.3333 1.3333 0 0 1 1.3333 1.33333v1.33334m0 6.66666v1.33337a1.3333 1.3333 0 0 1-1.3333 1.3333H9.99833m-6.66666 0H1.99833A1.33333 1.33333 0 0 1 .665 11.3317V9.99833" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33" /></Glyph>;
}

function SettingsIcon(props: IconProps) {
  return <Glyph height={16} viewBox="0 0 19.5352 21.5" width={14.5388} {...props}><path d="M9.988.75h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72V11a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73v.18a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73v-.18a2 2 0 0 0-2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><circle cx="9.768" cy="10.75" r="3" stroke="currentColor" strokeWidth="1.5" /></Glyph>;
}

function SquareUserRoundIcon(props: IconProps) {
  return <Glyph height={16} viewBox="0 0 19.5 19.5" width={16} {...props}><path d="M15.75 18.75a6 6 0 0 0-12 0m6-6a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7-12h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></Glyph>;
}

function TrashIcon(props: IconProps) {
  return <Glyph height={14.6633} viewBox="0 0 13.33 14.6633" width={13.33} {...props}><path d="M.665 3.33167h12M11.3317 3.33167V12.665c0 .6667-.6667 1.3333-1.33337 1.3333H3.33167c-.66667 0-1.33334-.6666-1.33334-1.3333V3.33167m2 0V1.99833c0-.66666.66667-1.33333 1.33334-1.33333h2.66666c.66667 0 1.33337.66667 1.33337 1.33333v1.33334" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33" /></Glyph>;
}

function UserRoundPlusIcon(props: IconProps) {
  return <Glyph height={15.2558} viewBox="0 0 21.5 20.5" width={16} {...props}><path d="M.75 18.75a8 8 0 0 1 13.292-6M17.75 13.75v6M20.75 16.75h-6m-1-11a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></Glyph>;
}

function XIcon(props: IconProps) {
  return <Glyph height={9.33} viewBox="0 0 9.33 9.33" width={9.33} {...props}><path d="m8.665.665-8 8m0-8 8 8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33" /></Glyph>;
}

export {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  DownloadBackupIcon,
  DownloadIcon,
  KeyRoundIcon,
  LinkOffIcon,
  ScanIcon,
  SettingsIcon,
  SquareUserRoundIcon,
  TrashIcon,
  UserRoundPlusIcon,
  XIcon,
};
