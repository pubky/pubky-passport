import { LogInIcon } from "./icons";

export function RequestContextBand({ label, requester }: { label: string; requester: string }) {
  return (
    <aside
      aria-label={`${label} ${requester}`}
      className="absolute inset-x-0 top-0 z-20 flex h-[var(--passport-context-band-height)] w-full shrink-0 items-center justify-start gap-1 border-b border-brand/20 bg-brand/10 px-6 text-xs font-medium leading-4 text-brand md:px-10"
      data-passport-context-band=""
    >
      <LogInIcon />
      <span className="min-w-0 truncate">
        {label} <bdi className="font-bold">{requester}</bdi>
      </span>
    </aside>
  );
}
