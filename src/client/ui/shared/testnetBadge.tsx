/**
 * Marks every page of an instance on the Pubky testnet (`PUBKY_NETWORK=testnet`), so nobody takes
 * its identities, keys or sign-ins for real ones. Mainnet shows nothing.
 */
function TestnetBadge({ network }: { network: "mainnet" | "testnet" }) {
  if (network !== "testnet") return null;
  return (
    <span
      className="shrink-0 rounded-full border border-warning/60 px-2 text-xs font-semibold uppercase leading-5 tracking-[0.1em] text-warning"
      title="This Passport uses the Pubky testnet. Its identities and sign-ins are for testing only."
    >
      Testnet
    </span>
  );
}

export { TestnetBadge };
