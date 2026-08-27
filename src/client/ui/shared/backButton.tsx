import { ArrowLeftIcon } from "./actionIcons";
import { Button } from "./primitives/button";

function BackButton({ disabled = false, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <Button className="w-full" disabled={disabled} onClick={onClick} size="lg" type="button" variant="secondary">
      <ArrowLeftIcon />
      Back
    </Button>
  );
}

export { BackButton };
