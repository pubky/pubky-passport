import Image from "next/image";

function PassportLogo() {
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages -- The logo must reload the document when returning home.
    <a className="inline-flex shrink-0 rounded-sm" href="/">
      <Image
        alt="Pubky"
        className="h-9 w-auto"
        height={200}
        priority
        src="/brand/pubky.svg"
        width={606}
      />
    </a>
  );
}

export { PassportLogo };
