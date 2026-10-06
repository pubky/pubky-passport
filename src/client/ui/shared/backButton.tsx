import { ArrowLeftIcon } from "./icons";
import { cn } from "./mergeClassNames";
import { Button } from "./primitives/button";

function BackButton({
  className,
  disabled = false,
  onClick,
}: {
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      // One size on every screen and window, on the left: the primary action takes the rest.
      className={cn("w-[120px]", className)}
      disabled={disabled}
      onClick={onClick}
      size="lg"
      type="button"
      variant="outline"
    >
      <ArrowLeftIcon />
      Back
    </Button>
  );
}

export { BackButton };
