import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KYROX — Tokenized equities with proof",
    short_name: "KYROX",
    description:
      "Public preview of the KYROX tokenized-equities workflow: transparent reference prices, deterministic quotes, and non-custodial review.",
    start_url: "/",
    display: "standalone",
    background_color: "#06070a",
    theme_color: "#06070a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
