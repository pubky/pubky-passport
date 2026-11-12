/**
 * The quiet way in for someone who already has a pubky: a text link under the provider choice,
 * deliberately less prominent than the Continue with Google/Apple pills.
 */
function ImportIdentityLink({ onImport }: { onImport: () => void }) {
  return (
    <p className="text-sm leading-5 text-muted-foreground" data-passport-import-identity="">
      Already have a pubky?{" "}
      <button
        className="cursor-pointer rounded-sm font-semibold text-brand underline decoration-brand/40 underline-offset-4 outline-none hover:decoration-brand focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onImport}
        type="button"
      >
        Use a recovery phrase or file
      </button>
    </p>
  );
}

export { ImportIdentityLink };
