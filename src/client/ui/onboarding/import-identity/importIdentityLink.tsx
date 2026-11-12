/**
 * The quiet way in for someone who already has a pubky: two lines of small text between the
 * provider buttons and the Terms notice, deliberately less prominent than the provider pills.
 */
function ImportIdentityLink({ onImport }: { onImport: () => void }) {
  return (
    <p className="text-sm leading-5 text-muted-foreground" data-passport-import-identity="">
      Already have a pubky?
      <br />
      <button
        className="cursor-pointer rounded-sm font-semibold text-brand underline decoration-brand/40 underline-offset-4 outline-none hover:decoration-brand focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onImport}
        type="button"
      >
        Import it
      </button>
    </p>
  );
}

export { ImportIdentityLink };
