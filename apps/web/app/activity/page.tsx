import type { Metadata } from "next";

import { ActivityView } from "../../components/activity-view";

export const metadata: Metadata = {
  title: "Activity",
  description:
    "Order and fill history for the KYROX testnet workflow, with status-aware titles and explicit simulated and on-chain labels.",
};

export default function ActivityPage() {
  return <ActivityView />;
}
