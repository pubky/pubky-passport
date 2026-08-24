import Image from "next/image";

const APP_STORE_URL = "https://apps.apple.com/us/app/pubky-ring/id6739356756";
const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=to.pubky.ring&hl=en-US";

function PubkyRingStoreBadges() {
  return (
    <div className="flex items-center justify-center gap-4">
      <a aria-label="Download Pubky Ring on the App Store" href={APP_STORE_URL} rel="noreferrer" target="_blank">
        <Image alt="Download on the App Store" height={32} src="/brand/app-store-badge.svg" width={96} />
      </a>
      <a aria-label="Get Pubky Ring on Google Play" href={GOOGLE_PLAY_URL} rel="noreferrer" target="_blank">
        <Image alt="Get it on Google Play" height={32} src="/brand/google-play-badge.svg" width={108} />
      </a>
    </div>
  );
}

export { PubkyRingStoreBadges };
