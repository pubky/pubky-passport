import { XIcon } from "./icons";
import { cn } from "./mergeClassNames";
import { Button } from "./primitives/button";

export function CancelButton({ className, onClick }: { className?: string; onClick: () => void }) {
  return (
    <Button
      className={cn("w-full min-[30rem]:w-[120px]", className)}
      onClick={onClick}
      size="lg"
      variant="outline"
    >
      <XIcon /> Cancel
    </Button>
  );
}
