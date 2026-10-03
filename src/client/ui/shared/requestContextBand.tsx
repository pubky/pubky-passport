import { useLayoutEffect, useRef, type ReactNode } from "react";
import { LogInIcon } from "./icons";

/**
 * Names who a request comes from. A long `requester` is cut at its start, never its end: the end
 * of a host name is its registrable domain, the part that says who really asks.
 */
export function RequestContextBand({
  label,
  requester,
  notice,
}: {
  label: string;
  requester: string;
  notice?: ReactNode;
}) {
  const band = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = band.current;
    if (!node) return;
    const style = node.ownerDocument.body.style;
    const property = "--passport-context-band-height";
    const previous = style.getPropertyValue(property);
    const priority = style.getPropertyPriority(property);
    let current: string | undefined;
    let active = true;
    const measure = () => {
      if (!active) return;
      const height = Math.ceil(node.getBoundingClientRect().height);
      if (height <= 0) return;
      current = `${height}px`;
      style.setProperty(property, current);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    if (observer) observer.observe(node);
    else window.addEventListener("resize", measure);
    return () => {
      active = false;
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", measure);
      if (current !== undefined && style.getPropertyValue(property) === current) {
        if (previous) style.setProperty(property, previous, priority);
        else style.removeProperty(property);
      }
    };
  }, [notice]);
  return (
    <aside
      ref={band}
      aria-label={`${label} ${requester}`}
      className="absolute inset-x-0 top-0 z-20 w-full shrink-0 border-b border-brand/20 bg-brand/10 px-6 text-xs font-medium leading-4 text-brand md:px-10"
      data-passport-context-band=""
    >
      <div className="flex min-h-[33px] items-center gap-1">
        <LogInIcon />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className="shrink-0">{label}</span>
            {/* Right-to-left only moves the ellipsis to the start; the host itself reads left to right. */}
            <span
              className="min-w-0 flex-1 truncate text-left"
              dir="rtl"
              title={requester}
              data-requester-host=""
            >
              <bdi className="font-bold" dir="ltr">
                {requester}
              </bdi>
            </span>
          </div>
        </div>
      </div>
      {notice ? <div className="pb-2">{notice}</div> : null}
    </aside>
  );
}
