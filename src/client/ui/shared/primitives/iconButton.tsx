import { Button, type ButtonProps } from "./button";

type IconButtonProps = Omit<ButtonProps, "size"> & { "aria-label": string };

function IconButton(props: IconButtonProps) {
  return <Button size="icon" {...props} />;
}

export { IconButton };
