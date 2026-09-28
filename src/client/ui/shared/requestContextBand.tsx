import { LogInIcon } from "./icons";

/**
 * Names who a request comes from. A long `requester` is cut at its start, never its end: the end
 * of a host name is its registrable domain, the part that says who really asks.
 */
export function RequestContextBand({ label, requester }: { label: string; requester: string }) {
  return (
    <aside
      aria-label={`${label} ${requester}`}
      className="absolute inset-x-0 top-0 z-20 flex h-[var(--passport-context-band-height)] w-full shrink-0 items-center justify-start gap-1 border-b border-brand/20 bg-brand/10 px-6 text-xs font-medium leading-4 text-brand md:px-10"
      data-passport-context-band=""
    >
      <LogInIcon />
      <span className="shrink-0">{label}</span>
      {/* Right-to-left only moves the ellipsis to the start; the host itself reads left to right. */}
      <span className="min-w-0 truncate text-left" dir="rtl" title={requester}>
        <bdi className="font-bold" dir="ltr">
          {requester}
        </bdi>
      </span>
    </aside>
  );
}
