import { usePassportProvider } from "@/client/ui/passportProviderConfiguration";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import {
  BackToAppAction,
  GoToPassportLink,
  RequestExitAction,
  useCameFromPage,
  useOpenedByApp,
} from "./requestExit";

const COPY = {
  // The capture lasts a minute; saying so would promise a lifetime the app does not control.
  expired: {
    title: "Request",
    accent: "expired.",
    cause: "This sign-in request took too long to open.",
    nextStep: "Go back to the app and start signing in again.",
  },
  invalid: {
    title: "Invalid sign-in",
    accent: "link.",
    cause: "This link can't be used to sign in.",
    nextStep:
      "Go back to the app and try again. If it keeps happening, contact the app's developer.",
  },
} as const;

/** Names the other network from this instance's: there are only two. */
function networkMismatchCopy(network: "mainnet" | "testnet") {
  const other = network === "testnet" ? "main network" : "testnet";
  const own = network === "testnet" ? "testnet" : "main network";
  return {
    title: "Different",
    accent: "network.",
    cause: `This app signs in on the Pubky ${other}, and this Passport works on the ${own}.`,
    nextStep: "Go back to the app and sign in with a Passport on its network.",
  };
}

/**
 * A request that cannot be reviewed: one that expired before Passport's page could take it, which
 * starting again fixes, or a link that cannot be used at all. Either way the person goes back to
 * the app: in its popup by closing the window, and in a tab the app sent them to by going back.
 * Passport's start page (for a first-time user, its onboarding) is then only a side action, and
 * the main one only in a tab with no page before it.
 */
function InvalidAuthorization({ reason }: { reason: "expired" | "invalid" | "network_mismatch" }) {
  return reason === "network_mismatch" ? (
    <NetworkMismatch />
  ) : (
    <InvalidAuthorizationScreen copy={COPY[reason]} />
  );
}

/** A request made for the other Pubky network, named from this instance's. */
function NetworkMismatch() {
  const { network } = usePassportProvider();
  return <InvalidAuthorizationScreen copy={networkMismatchCopy(network.network)} />;
}

function InvalidAuthorizationScreen({
  copy,
}: {
  copy: { title: string; accent: string; cause: string; nextStep: string };
}) {
  const inPopup = useOpenedByApp();
  const cameFromPage = useCameFromPage();
  const backInTab = !inPopup && cameFromPage;
  return (
    <ErrorScreen
      accent={copy.accent}
      action={backInTab ? <BackToAppAction /> : <RequestExitAction inPopup={inPopup} />}
      cause={copy.cause}
      nextStep={copy.nextStep}
      secondaryAction={inPopup || backInTab ? <GoToPassportLink /> : undefined}
      title={copy.title}
    />
  );
}

export { InvalidAuthorization };
