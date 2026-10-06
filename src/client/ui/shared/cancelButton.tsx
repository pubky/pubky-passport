import { XIcon } from "./icons";
import { cn } from "./mergeClassNames";
import { Button } from "./primitives/button";

export function CancelButton({ className, onClick }: { className?: string; onClick: () => void }) {
  return (
    <Button
      // Back's size: it plays the same part where there is nothing to go back to.
      className={cn("w-[120px]", className)}
      onClick={onClick}
      size="lg"
      variant="outline"
    >
      <XIcon /> Cancel
    </Button>
  );
}
