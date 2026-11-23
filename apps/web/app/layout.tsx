import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AccountProvider } from "../components/account-provider";
import { SiteFooter } from "../components/site-footer";
import { SiteNav } from "../components/site-nav";
import { appUrl } from "../lib/app-url";

import "./globals.css";

const TITLE = "KYROX — Tokenized equities with proof";
const DESCRIPTION =
  "KYROX is a non-custodial tokenized-equities platform on Base Sepolia. Transparent reference quotes, source-timestamped prices, deterministic policy, and an agent-ready MCP bridge. Public simulated preview.";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: TITLE,
    template: "%s · KYROX",
  },
  description: DESCRIPTION,
  applicationName: "KYROX",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    type: "website",
    siteName: "KYROX",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#06070a",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AccountProvider>
          <SiteNav />
          <main className="site-main">{children}</main>
          <SiteFooter />
        </AccountProvider>
      </body>
    </html>
  );
}
