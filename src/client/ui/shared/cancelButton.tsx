import { XIcon } from "./icons";
import { cn } from "./mergeClassNames";
import { Button } from "./primitives/button";

export function CancelButton({ className, onClick }: { className?: string; onClick: () => void }) {
  return (
    <Button
      className={cn("w-full md:w-[120px]", className)}
      onClick={onClick}
      size="lg"
      variant="outline"
    >
      <XIcon /> Cancel
    </Button>
  );
}
