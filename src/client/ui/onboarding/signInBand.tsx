import { LockIcon } from "../shared/icons";

function SignInBand({ requester }: { requester: string }) {
  return (
    <aside
      aria-label={`Signing in to ${requester}`}
      className="absolute inset-x-0 top-0 z-20 flex h-[var(--passport-context-band-height)] w-full shrink-0 items-center justify-center gap-1 border-b border-brand/20 bg-brand/10 px-4 text-xs font-medium leading-4 text-brand"
      data-passport-context-band=""
    >
      <LockIcon />
      <span className="min-w-0 truncate">
        Signing in to <bdi className="font-bold">{requester}</bdi>
      </span>
    </aside>
  );
}

export { SignInBand };
