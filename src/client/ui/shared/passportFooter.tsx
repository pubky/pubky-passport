import { BrandEndorsement } from "./brand/brandEndorsement";
import { LegalLinks } from "./legal/legalLinks";

function PassportFooter() {
  return (
    <footer className="passport-footer mt-auto flex w-full shrink-0 flex-col gap-6 border-t border-border px-6 py-8 md:h-18 md:flex-row md:items-center md:justify-between md:border-0 md:px-10 md:py-0">
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium leading-5 text-muted-foreground md:hidden">
          Pubky Passport is powered by the{" "}
          <a
            className="rounded-sm font-semibold text-brand underline decoration-brand/40 underline-offset-4 outline-none hover:decoration-brand focus-visible:ring-3 focus-visible:ring-ring/50"
            href="https://pubky.org/"
            rel="noreferrer"
            target="_blank"
          >
            Pubky protocol
          </a>
          . Built by Synonym Software, S.A. DE C.V. ©2026.
        </p>
        <LegalLinks />
      </div>
      <BrandEndorsement />
    </footer>
  );
}

export { PassportFooter };
