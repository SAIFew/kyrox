import type { Metadata } from "next";

import { ActivityView } from "../../components/activity-view";

export const metadata: Metadata = {
  title: "Activity",
  description:
    "Order and fill history for the KYROX public preview, with explicit simulated and on-chain labels.",
};

export default function ActivityPage() {
  return <ActivityView />;
}
