import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "../../ui/components/button";

const VARIANTS = ["default", "secondary", "outline", "destructive"] as const;
const SIZES = ["default", "lg", "icon"] as const;

export default function ComponentGalleryPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-6 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-brand">Development only</p>
        <h1 className="text-3xl font-bold">Button gallery</h1>
        <p className="text-sm text-muted-foreground">
          Figma variants and sizes currently supported by the Passport Button primitive.
        </p>
      </header>

      <section className="flex flex-col gap-5">
        <h2 className="text-xl font-bold">Figma examples</h2>
        <div className="grid gap-4 rounded-xl border bg-background p-6 sm:grid-cols-2">
          <Button className="w-full max-w-[327px]" size="lg" variant="secondary">
            <ScanIcon />
            Scan QR
          </Button>
          <Button className="w-full max-w-[327px]" size="lg">
            <ArrowRightIcon />
            Continue
          </Button>
          <Button className="w-full max-w-[327px]" size="lg" variant="outline">
            <XIcon />
            Cancel
          </Button>
          <Button className="w-full max-w-[327px]" size="lg">
            <CheckIcon />
            Authorize
          </Button>
          <Button className="w-full max-w-[327px]" size="lg" variant="destructive">
            <TrashIcon />
            Remove Google Access
          </Button>
        </div>
      </section>

      {VARIANTS.map((variant) => (
        <section className="flex flex-col gap-5" key={variant}>
          <h2 className="text-xl font-bold capitalize">{variant}</h2>
          <div className="grid gap-6 rounded-xl border bg-card p-6 sm:grid-cols-2 lg:grid-cols-3">
            {SIZES.map((size) => (
              <PreviewCell key={size} label={size}>
                <GalleryButton size={size} variant={variant} />
              </PreviewCell>
            ))}
          </div>
        </section>
      ))}

      <section className="flex flex-col gap-5">
        <h2 className="text-xl font-bold">Disabled</h2>
        <div className="grid gap-6 rounded-xl border bg-card p-6 sm:grid-cols-2">
          {VARIANTS.map((variant) => (
            <PreviewCell key={variant} label={variant}>
              <GalleryButton disabled size="lg" variant={variant} />
            </PreviewCell>
          ))}
        </div>
      </section>
    </main>
  );
}

function GalleryButton({
  size,
  variant,
  disabled = false,
}: {
  disabled?: boolean;
  size: (typeof SIZES)[number];
  variant: (typeof VARIANTS)[number];
}) {
  const { icon, label } = BUTTON_CONTENT[variant];

  if (size === "icon") {
    return (
      <Button aria-label={`${label} icon button`} disabled={disabled} size="icon" variant={variant}>
        {icon}
      </Button>
    );
  }

  return (
    <Button disabled={disabled} size={size} variant={variant}>
      {icon}
      {label}
    </Button>
  );
}

const BUTTON_CONTENT: Record<(typeof VARIANTS)[number], { icon: ReactNode; label: string }> = {
  default: { icon: <CheckIcon />, label: "Authorize" },
  destructive: { icon: <TrashIcon />, label: "Remove Google Access" },
  outline: { icon: <XIcon />, label: "Cancel" },
  secondary: { icon: <ScanIcon />, label: "Scan QR" },
};

function PreviewCell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function ArrowRightIcon() {
  return (
    <span aria-hidden="true" className="flex size-4 items-center justify-center">
      <span
        className="block bg-contain bg-center bg-no-repeat"
        style={{
          backgroundImage: "url('/icons/figma-arrow-right.svg')",
          height: "10.6633px",
          width: "10.6633px",
        }}
      />
    </span>
  );
}

function ScanIcon() {
  return <FigmaIcon asset="figma-scan.svg" height="13.33px" width="13.33px" />;
}

function CheckIcon() {
  return <FigmaIcon asset="figma-check.svg" height="8.66333px" width="11.9967px" />;
}

function TrashIcon() {
  return <FigmaIcon asset="figma-trash.svg" height="14.6633px" width="13.33px" />;
}

function XIcon() {
  return <FigmaIcon asset="figma-x.svg" height="9.33px" width="9.33px" />;
}

function FigmaIcon({ asset, height, width }: { asset: string; height: string; width: string }) {
  return (
    <span aria-hidden="true" className="flex size-4 items-center justify-center">
      <span
        className="block bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: `url('/icons/${asset}')`, height, width }}
      />
    </span>
  );
}
