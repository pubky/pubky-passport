import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";

/** Collapsed support diagnostics for a Google identity view error. */
function GoogleIdentityErrorDetails({ error }: { error: GoogleIdentityViewError }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium leading-5 text-muted-foreground">
        Technical details
      </summary>
      <div className="mt-2 flex flex-col gap-0">
        <p className="break-all text-sm leading-5 text-muted-foreground">{error.code}</p>
        {error.detailCode !== undefined ? (
          <p className="break-all text-sm leading-5 text-muted-foreground">{error.detailCode}</p>
        ) : null}
      </div>
    </details>
  );
}

export { GoogleIdentityErrorDetails };
