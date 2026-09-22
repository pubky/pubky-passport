import Image from "next/image";

function PassportLogo() {
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages -- The logo must reload the document when returning home.
    <a
      className="inline-flex shrink-0 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      href="/"
    >
      <Image alt="Pubky Passport" height={36} priority src="/brand/passport-logo.svg" width={214} />
    </a>
  );
}

export { PassportLogo };
