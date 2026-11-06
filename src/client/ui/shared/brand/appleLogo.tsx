import Image from "next/image";

/**
 * Apple's own logo file for a custom Sign in with Apple button, unchanged: "Logo - SIWA -
 * Left-aligned - Black - Small.svg" from the Sign in with Apple logo files in Apple Design
 * Resources (developer.apple.com/design/resources). The file is 24 by 44 with Apple's padding
 * built in, so the button shows it at its full height: not cropped, no padding added.
 *
 * Apple's guidelines allow the Apple logo only inside a Sign in with Apple button. Everywhere
 * else Passport names the "Apple Account" in text instead.
 */
function AppleSignInLogo() {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className="h-full w-auto shrink-0"
      height={44}
      priority
      src="/brand/sign-in-with-apple/logo-left-aligned-black-small.svg"
      width={24}
    />
  );
}

export { AppleSignInLogo };
