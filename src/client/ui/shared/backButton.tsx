import { ArrowLeftIcon } from "./actionIcons";
import { Button } from "./primitives/button";

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button className="w-full" onClick={onClick} size="lg" type="button" variant="secondary">
      <ArrowLeftIcon />
      Back
    </Button>
  );
}

export { BackButton };
