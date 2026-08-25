import { forwardRef } from "react";

import { Button, type ButtonProps } from "./button";

type IconButtonProps = Omit<ButtonProps, "size"> & { "aria-label": string };

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>((props, ref) => <Button ref={ref} size="icon" {...props} />);
IconButton.displayName = "IconButton";

export { IconButton };
