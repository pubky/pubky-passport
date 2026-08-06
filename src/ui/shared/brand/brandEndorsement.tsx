import Image from "next/image";

function BrandEndorsement() {
  return (
    <div aria-label="Synonym, a Tether company" className="flex items-center gap-[10px]">
      <div aria-hidden="true" className="relative h-6 w-[95.04px] shrink-0">
        <Image alt="" className="absolute left-0 top-0" height={24} src="/brand/synonym-mark.svg" width={24} />
        <Image alt="" className="absolute left-[8.77px] top-[5.31px]" height={13.38} src="/brand/synonym-inner.svg" width={6.45} />
        <Image alt="" className="absolute left-[32.06px] top-[6.6px]" height={13.13} src="/brand/synonym-wordmark.svg" width={62.77} />
      </div>
      <div aria-hidden="true" className="relative h-4 w-[109px] shrink-0">
        <Image alt="" className="absolute bottom-[2.85px] left-[0.28px]" height={7.33} src="/brand/tether-a.svg" width={6.12} />
        <Image alt="" className="absolute bottom-[3px] left-[11px]" height={9} src="/brand/tether-wordmark.svg" width={40} />
        <Image alt="" className="absolute bottom-[0.35px] left-[54.31px]" height={9.84} src="/brand/tether-company.svg" width={54.15} />
      </div>
    </div>
  );
}

export { BrandEndorsement };
