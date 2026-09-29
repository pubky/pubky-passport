import { notFound } from "next/navigation";
import { KeyLockSpikeView } from "@/client/ui/dev/keyLockSpike";

export default function KeyLockSpikePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <KeyLockSpikeView />;
}
