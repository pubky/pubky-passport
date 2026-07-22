import { publicEnv } from "../libs/env/public-env";
import { DevelopmentIdentityPanel } from "../ui/developmentIdentityPanel";

export default function Home() {
  return <DevelopmentIdentityPanel relayOrigin={new URL(publicEnv.NEXT_PUBLIC_HTTP_RELAY_URL).origin} />;
}
