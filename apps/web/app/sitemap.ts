import type { MetadataRoute } from "next";

import { appUrl } from "../lib/app-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  const now = new Date();
  const routes = [
    { path: "", priority: 1 },
    { path: "/markets", priority: 0.9 },
    { path: "/markets/tAAPL", priority: 0.8 },
    { path: "/markets/tTSLA", priority: 0.8 },
    { path: "/markets/tNVDA", priority: 0.8 },
    { path: "/portfolio", priority: 0.6 },
    { path: "/activity", priority: 0.5 },
    { path: "/developers", priority: 0.7 },
    { path: "/status", priority: 0.6 },
    { path: "/legal", priority: 0.3 },
  ];
  return routes.map((route) => ({
    url: `${base}${route.path}`,
    lastModified: now,
    changeFrequency: route.path === "" || route.path === "/markets" ? "daily" : "weekly",
    priority: route.priority,
  }));
}
