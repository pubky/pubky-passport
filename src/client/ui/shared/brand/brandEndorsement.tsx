import Image from "next/image";

function BrandEndorsement() {
  return (
    <Image
      alt="Synonym, a Tether company"
      className="shrink-0"
      height={24}
      src="/brand/brand-endorsement.svg"
      width={215}
    />
  );
}

export { BrandEndorsement };
