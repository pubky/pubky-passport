import Image from "next/image";

const APP_STORE_URL = "https://apps.apple.com/us/app/pubky-ring/id6739356756";
const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=to.pubky.ring&hl=en-US";

/** Each badge link is at least 44px tall, so a thumb hits it even where the badge art is smaller. */
function PubkyRingStoreBadges() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 md:justify-start">
      <a
        aria-label="Download Pubky Ring on the App Store"
        className="flex min-h-11 items-center rounded-md"
        href={APP_STORE_URL}
        rel="noreferrer"
        target="_blank"
      >
        <Image
          alt="Download on the App Store"
          className="h-8 w-24 md:h-10 md:w-[120px]"
          height={40}
          src="/brand/app-store-badge.svg"
          width={120}
        />
      </a>
      <a
        aria-label="Get Pubky Ring on Google Play"
        className="flex min-h-11 items-center rounded-md"
        href={GOOGLE_PLAY_URL}
        rel="noreferrer"
        target="_blank"
      >
        <Image
          alt="Get it on Google Play"
          className="h-8 w-[108px] md:h-10 md:w-[135px]"
          height={40}
          src="/brand/google-play-badge.svg"
          width={135}
        />
      </a>
    </div>
  );
}

export { PubkyRingStoreBadges };
