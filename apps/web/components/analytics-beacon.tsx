"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Page-view beacon. Sends only the route path; never wallet, query string, or
 * content. The API is a no-op acknowledgement in preview mode.
 */
export function AnalyticsBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "page_view", props: { path: pathname } }),
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname]);
  return null;
}
