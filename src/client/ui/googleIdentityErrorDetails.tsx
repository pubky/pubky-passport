import { useId } from "react";

import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import { Label } from "@/client/ui/shared/primitives/label";

/** Visible support diagnostics for a Google identity view error. */
function GoogleIdentityErrorDetails({ error }: { error: GoogleIdentityViewError }) {
  const labelId = useId();

  return (
    <div className="flex flex-col gap-2">
      <Label className="leading-5" id={labelId}>
        Error
      </Label>
      <div
        aria-labelledby={labelId}
        className="flex min-h-14 flex-col justify-center gap-0 rounded-lg border border-dashed border-input bg-black/10 py-4 pl-6 pr-5 shadow-xs"
        role="group"
      >
        <p className="break-all text-base font-medium leading-6 text-foreground">{error.code}</p>
        {error.detailCode !== undefined ? (
          <p className="break-all text-base font-medium leading-6 text-foreground">
            {error.detailCode}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export { GoogleIdentityErrorDetails };
