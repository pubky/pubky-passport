import { ArrowLeftIcon } from "./actionIcons";
import { cn } from "./mergeClassNames";
import { Button } from "./primitives/button";

function BackButton({ className, disabled = false, onClick }: { className?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <Button className={cn("w-full md:w-[120px]", className)} disabled={disabled} onClick={onClick} size="lg" type="button" variant="outline">
      <ArrowLeftIcon />
      Back
    </Button>
  );
}

export { BackButton };
