import type { NextConfig } from "next";

/**
 * The marketing surface is a fully static site. There are no route handlers,
 * server actions, runtime secrets, or application-server requirements.
 * `output: "export"` emits plain HTML/CSS/JS into `out/` for a separate host.
 */
const nextConfig: NextConfig = {
  output: "export",
  poweredByHeader: false,
  reactStrictMode: true,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
