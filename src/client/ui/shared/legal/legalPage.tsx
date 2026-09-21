import type { ReactNode } from "react";

type LegalPageProps = {
  children: ReactNode;
  eyebrow: string;
  title: string;
};

function LegalPage({ children, eyebrow, title }: LegalPageProps) {
  return (
    <main className="mx-auto w-full max-w-5xl grow px-6 pb-24 pt-4 md:px-10 md:pb-32 md:pt-8">
      <nav aria-label="Legal documents" className="mb-14 flex items-center gap-2 md:mb-20">
        <LegalDocumentLink href="/terms-of-service">Terms of Service</LegalDocumentLink>
        <LegalDocumentLink href="/privacy-policy">Privacy Policy</LegalDocumentLink>
      </nav>

      <header className="mb-14 border-b border-border pb-12 md:mb-20 md:pb-16">
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="max-w-3xl text-5xl font-bold leading-[0.95] tracking-[-0.03em] md:text-7xl">
          {title}
          <span className="text-brand">.</span>
        </h1>
      </header>

      <article className="legal-document max-w-3xl">{children}</article>
    </main>
  );
}

function LegalDocumentLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <a
      className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none transition-colors hover:border-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      href={href}
    >
      {children}
    </a>
  );
}

function LegalSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function SectionIntroduction({ children }: { children: ReactNode }) {
  return <p className="legal-section-introduction">{children}</p>;
}

export { LegalPage, LegalSection, SectionIntroduction };
