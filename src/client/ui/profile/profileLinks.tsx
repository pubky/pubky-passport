import { useId } from "react";

import { profileLinkHref, type PubkyProfile } from "@/client/logic/profile/profile";

const LINK_CLASS_NAME =
  "rounded-sm font-medium text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand";

/**
 * A published profile's links, each under its title. A web address without credentials opens in a
 * new tab; one with credentials, and any other address the specs accept (`pubky:`, `mailto:`,
 * `javascript:`, …), is shown as text, never as a link. The address itself is what is shown, so where a link leads is always visible.
 */
export function ProfileLinks({ links }: { links: PubkyProfile["links"] }) {
  const labelId = useId();
  if (!links?.length) return null;
  return (
    <div className="w-full min-w-0">
      <p
        className="mb-1 text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground"
        id={labelId}
      >
        Links
      </p>
      <ul aria-labelledby={labelId} className="flex flex-col gap-3">
        {links.map(({ title, url }, index) => {
          const href = profileLinkHref(url);
          return (
            <li className="flex min-w-0 flex-col text-sm leading-5" key={index}>
              <span className="break-words text-secondary-foreground">{title}</span>
              {href ? (
                <a
                  className={`break-all ${LINK_CLASS_NAME}`}
                  href={href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {url} <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                <span className="break-all font-medium">{url}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
