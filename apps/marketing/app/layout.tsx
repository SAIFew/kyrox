import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { SiteNav } from "../components/SiteNav";

import "./globals.css";

const TITLE = "KYROX — Onchain intelligence. Security by design.";
const DESCRIPTION =
  "KYROX is an AI-assisted onchain finance project under development: market context, portfolio intelligence, transparent quotes, and user-authorized transaction workflows.";

export const metadata: Metadata = {
  title: TITLE,
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
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
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
        <SiteNav />
        {children}
        <footer className="site-footer">
          <div className="wrap footer-inner">
            <div className="footer-brand">
              <span className="logo-word">KYROX</span>
              <p>
                Onchain intelligence. Security by design. An independent project building in public
                on X.
              </p>
              <a
                className="footer-x"
                href="https://x.com/Kyrox_io"
                rel="noopener noreferrer"
                target="_blank"
              >
                @Kyrox_io
                <span aria-hidden="true">↗</span>
              </a>
            </div>
            <div className="footer-notes">
              <p>
                KYROX is under development. The consumer application is a local prototype. Base
                Sepolia testnet preparation is ongoing; mainnet live trading is not available.
              </p>
              <p>
                Testnet assets have no real-world or cash value. Nothing here is investment advice,
                an offer, a solicitation, or an endorsement by Base or any other organization.
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
