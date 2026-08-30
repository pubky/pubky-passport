import { BrandEndorsement } from "./brand/brandEndorsement";

function MobilePassportFooter() {
  return (
    <footer className="mt-auto flex flex-col gap-4 text-sm font-medium leading-5 text-muted-foreground md:hidden">
      <p>
        Pubky Passport is powered by the Pubky protocol. Built by Synonym Software, S.A. DE C.V.
        ©2026.
      </p>
      <BrandEndorsement />
    </footer>
  );
}

export { MobilePassportFooter };
