import { IconButton } from "../components/icon-button";

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton aria-label="Back" className="size-9" onClick={onClick} variant="ghost">
      <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
        <path d="M13.33 8H2.67m0 0 4-4m-4 4 4 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      </svg>
    </IconButton>
  );
}

export { BackButton };
