import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";

type IconProps = { className?: string; size?: 16 | 20 };

function Glyph({
  children,
  className,
  height,
  size = 16,
  viewBox,
  width,
}: IconProps & {
  children: ReactNode;
  height: number;
  viewBox: string;
  width: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        size === 20 ? "size-5" : "size-4",
        className,
      )}
    >
      <svg fill="none" style={{ height, width }} viewBox={viewBox}>
        {children}
      </svg>
    </span>
  );
}

function ArrowLeftIcon(props: IconProps) {
  return (
    <Glyph height={10.6633} viewBox="0 0 10.6633 10.6633" width={10.6633} {...props}>
      <path
        d="M5.33167.665.665 5.33167l4.66667 4.66666M.665 5.33167h9.33333"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.33"
      />
    </Glyph>
  );
}

function ArrowRightIcon(props: IconProps) {
  return (
    <Glyph height={10.6633} viewBox="0 0 10.6633 10.6633" width={10.6633} {...props}>
      <path
        d="M.665 5.33167h9.33333M5.33167 9.99833l4.66666-4.66666L5.33167.665"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.33"
      />
    </Glyph>
  );
}

function CheckIcon(props: IconProps) {
  return (
    <Glyph height={8.66333} viewBox="0 0 11.9967 8.66333" width={11.9967} {...props}>
      <path
        d="m11.3317.665-7.33337 7.33333L.665 4.665"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.33"
      />
    </Glyph>
  );
}

function CameraIcon({ className }: Pick<IconProps, "className">) {
  return (
    <span aria-hidden="true" className={cn("relative inline-flex h-4 w-5 shrink-0", className)}>
      <svg
        className="absolute -left-[0.75px] -top-[0.75px] max-w-none"
        fill="none"
        height={17.5}
        viewBox="0 0 21.5 17.5"
        width={21.5}
      >
        <path
          d="M13.25.75h-5l-2.5 3h-3a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-3l-2.5-3Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <circle
          cx="10.75"
          cy="9.75"
          r="3"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    </span>
  );
}

function CircleCheckIcon(props: IconProps) {
  const size = props.size ?? 20;

  return (
    <Glyph height={size} size={size} viewBox="0 0 20 20" width={size} {...props}>
      <path
        clipRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882L9.16 12.099l-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </Glyph>
  );
}

function CircleInfoIcon(props: IconProps) {
  const size = props.size ?? 20;

  return (
    <Glyph height={size} size={size} viewBox="0 0 20 20" width={size} {...props}>
      <path
        clipRule="evenodd"
        d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM11 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </Glyph>
  );
}

function CopyIcon(props: IconProps) {
  return (
    <Glyph height={props.size ?? 16} viewBox="0 0 21.5 21.5" width={props.size ?? 16} {...props}>
      <path
        d="M2.75 14.75a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2m-6 4h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Glyph>
  );
}

function ClipboardPasteIcon(props: IconProps) {
  return (
    <Glyph height={17.9967} viewBox="0 0 15.4967 17.9967" width={15.4967} {...props}>
      <path
        d="M3.99833 2.33167H2.33167c-.44203 0-.86595.17559-1.17851.48815A1.66668 1.66668 0 0 0 .665 3.99833V15.665c0 .442.175595.866.48816 1.1785.31256.3126.73648.4882 1.17851.4882h10c.442 0 .8659-.1756 1.1785-.4882.3125-.3125.4881-.7365.4881-1.1785M10.665 2.33167h1.6667c.442 0 .8659.17559 1.1785.48815.3125.31256.4881.73649.4881 1.17851V5.665M6.49833 10.665h8.33337m-3.3334 3.3333 3.3334-3.3333-3.3334-3.33333M9.83167.665h-5c-.22102 0-.43298.087797-.58926.244078-.15628.156282-.24408.368242-.24408.589252V3.165c0 .5.33334.83333.83334.83333h5c.50003 0 .83333-.33333.83333-.83333V1.49833C10.665.998333 10.3317.665 9.83167.665Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.33"
      />
    </Glyph>
  );
}

function DownloadRecoveryFileIcon(props: IconProps) {
  return (
    <Glyph height={13.33} viewBox="0 0 13.33 13.33" width={13.33} {...props}>
      <path
        d="M12.665 8.665v2.6667a1.3333 1.3333 0 0 1-1.3333 1.3333H1.99833A1.3333 1.3333 0 0 1 .665 11.3317V8.665m9.33333-3.33333L6.665 8.665 3.33167 5.33167M6.665 8.665v-8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.33"
      />
    </Glyph>
  );
}

function DownloadIcon(props: IconProps) {
  return (
    <Glyph height={16} viewBox="0 0 19.5 19.5" width={16} {...props}>
      <path
        d="M18.75 12.75v4a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2v-4m14-5-5 5-5-5m5 5v-12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Glyph>
  );
}

function FolderIcon(props: IconProps) {
  return (
    <Glyph height={12.8333} viewBox="0 0 14.8333 12.8333" width={14.8333} {...props}>
      <path
        d="M12.75 12.0833c.3536 0 .6928-.1404.9428-.3905.2501-.25.3905-.5892.3905-.9428V4.08333c0-.35362-.1404-.69276-.3905-.94281A1.3333 1.3333 0 0 0 12.75 2.75H7.48333a1.3332 1.3332 0 0 1-1.12666-.6l-.54-.8a1.3333 1.3333 0 0 0-1.11334-.6h-2.62c-.35362 0-.69276.140476-.94281.39052A1.33333 1.33333 0 0 0 .75 2.08333V10.75c0 .3536.140476.6928.39052.9428.25005.2501.58919.3905.94281.3905H12.75Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Glyph>
  );
}

function KeyRoundIcon(props: IconProps) {
  return (
    <Glyph height={16} viewBox="0 0 21.5382 21.5382" width={16} {...props}>
      <path d="M15.25 6.78833a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z" fill="currentColor" />
      <path
        d="M.75 16.7882v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4l-7.4 7.4Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M15.25 6.78833a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Glyph>
  );
}

function LinkOffIcon(props: IconProps) {
  return (
    <Glyph height={16} viewBox="0 0 21.5 21.5" width={16} {...props}>
      <path
        d="M7.75 15.75h-2a5 5 0 0 1 0-10m8 0h2a5 5 0 0 1 4 8m-13-3h4m-10-10 20 20"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Glyph>
  );
}

function LogInIcon(props: IconProps) {
  return (
    <Glyph height={16} viewBox="0 0 24 24" width={16} {...props}>
      <path
        d="M15 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H15M10 7L15 12L10 17M15 12H3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Glyph>
  );
}

function LogOutIcon(props: IconProps) {
  return (
    <Glyph height={16} viewBox="0 0 24 24" width={16} {...props}>
      <path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </Glyph>
  );
}

function RotateCcwIcon(props: IconProps) {
  return (
    <Glyph height={16} viewBox="0 0 19.5 19.5" width={16} {...props}>
      <path
        d="M.75 9.75c0 1.78.528 3.52 1.517 5s2.394 2.634 4.039 3.315a9 9 0 0 0 5.2.512 9 9 0 0 0 4.608-2.463 9 9 0 0 0 2.463-4.608 9 9 0 0 0-.512-5.2 9 9 0 0 0-3.315-4.039A9 9 0 0 0 9.75.75 9.83 9.83 0 0 0 3.01 3.49L.75 5.75m5 0h-5v-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Glyph>
  );
}

function ScanIcon(props: IconProps) {
  return (
    <Glyph height={13.33} viewBox="0 0 13.33 13.33" width={13.33} {...props}>
      <path
        d="M.665 3.33167V1.99833A1.33333 1.33333 0 0 1 1.99833.665h1.33334M9.99833.665h1.33337a1.3333 1.3333 0 0 1 1.3333 1.33333v1.33334m0 6.66666v1.33337a1.3333 1.3333 0 0 1-1.3333 1.3333H9.99833m-6.66666 0H1.99833A1.33333 1.33333 0 0 1 .665 11.3317V9.99833"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.33"
      />
    </Glyph>
  );
}

function SettingsIcon(props: IconProps) {
  return (
    <Glyph height={16} viewBox="0 0 19.5352 21.5" width={14.5388} {...props}>
      <path
        d="M9.988.75h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72V11a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73v.18a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73v-.18a2 2 0 0 0-2-2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <circle cx="9.768" cy="10.75" r="3" stroke="currentColor" strokeWidth="1.5" />
    </Glyph>
  );
}

function SquareUserRoundIcon(props: IconProps) {
  return (
    <Glyph height={16} viewBox="0 0 19.5 19.5" width={16} {...props}>
      <path
        d="M15.75 18.75a6 6 0 0 0-12 0m6-6a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7-12h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Glyph>
  );
}

function TrashIcon(props: IconProps) {
  return (
    <Glyph height={14.6633} viewBox="0 0 13.33 14.6633" width={13.33} {...props}>
      <path
        d="M.665 3.33167h12M11.3317 3.33167V12.665c0 .6667-.6667 1.3333-1.33337 1.3333H3.33167c-.66667 0-1.33334-.6666-1.33334-1.3333V3.33167m2 0V1.99833c0-.66666.66667-1.33333 1.33334-1.33333h2.66666c.66667 0 1.33337.66667 1.33337 1.33333v1.33334"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.33"
      />
    </Glyph>
  );
}

function UserRoundPlusIcon(props: IconProps) {
  return (
    <Glyph height={15.2558} viewBox="0 0 21.5 20.5" width={16} {...props}>
      <path
        d="M.75 18.75a8 8 0 0 1 13.292-6M17.75 13.75v6M20.75 16.75h-6m-1-11a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </Glyph>
  );
}

function XIcon(props: IconProps) {
  return (
    <Glyph height={9.33} viewBox="0 0 9.33 9.33" width={9.33} {...props}>
      <path
        d="m8.665.665-8 8m0-8 8 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.33"
      />
    </Glyph>
  );
}

export {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleInfoIcon,
  ClipboardPasteIcon,
  CopyIcon,
  DownloadRecoveryFileIcon,
  DownloadIcon,
  FolderIcon,
  KeyRoundIcon,
  LinkOffIcon,
  LogInIcon,
  LogOutIcon,
  RotateCcwIcon,
  ScanIcon,
  SettingsIcon,
  SquareUserRoundIcon,
  TrashIcon,
  UserRoundPlusIcon,
  XIcon,
};
