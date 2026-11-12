import { Spinner } from "@/client/ui/shared/primitives/spinner";

/** The pubky the recovery material opened, shown while signing in and after a failure. */
function RecoveredPubky({ pending, publicKeyZ32 }: { pending: boolean; publicKeyZ32: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-card p-4" role="status">
      {pending ? (
        <Spinner
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-brand"
          role="presentation"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
          {pending ? "Signing in as" : "Pubky"}
        </p>
        <p className="break-all text-sm font-medium leading-5">{publicKeyZ32}</p>
      </div>
    </div>
  );
}

export { RecoveredPubky };
