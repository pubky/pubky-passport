import { cn } from "@/client/ui/shared/mergeClassNames";

function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={cn("flex items-center gap-4", className)}>
      <a
        className="rounded-sm text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        href="/terms-of-service"
      >
        Terms of Service
      </a>
      <a
        className="rounded-sm text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        href="/privacy-policy"
      >
        Privacy Policy
      </a>
    </nav>
  );
}

export { LegalLinks };
