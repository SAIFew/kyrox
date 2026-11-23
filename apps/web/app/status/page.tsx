import type { Metadata } from "next";

import { StatusView } from "../../components/status-view";

export const metadata: Metadata = {
  title: "System status",
  description:
    "Honest environment status for KYROX: application, market data, contract deployment, publication, and indexing.",
};

export default function StatusPage() {
  return <StatusView />;
}
