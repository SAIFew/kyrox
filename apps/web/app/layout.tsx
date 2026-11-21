import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "KYROX — Base Sepolia testnet",
  description:
    "KYROX consumer application. Testnet-only prototype on Base Sepolia. No real-money trading.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
