"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useAccount, ConnectButton } from "./account-provider";
import { ActivityIcon, ChartIcon, CodeIcon, GridIcon, CloseIcon, InfoIcon } from "./icons";
import { Logo } from "./logo";

const PRIMARY = [
  { href: "/markets", label: "Markets", icon: ChartIcon },
  { href: "/portfolio", label: "Portfolio", icon: GridIcon },
  { href: "/activity", label: "Activity", icon: ActivityIcon },
  { href: "/developers", label: "Developers", icon: CodeIcon },
] as const;

const SECONDARY = [
  { href: "/status", label: "System status" },
  { href: "/developers", label: "Agent bridge (MCP)" },
  { href: "/legal", label: "Risk & terms" },
] as const;

export function SiteNav() {
  const pathname = usePathname();
  const { environment } = useAccount();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const simulated = environment?.simulated ?? true;
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header className="site-header">
        <div className="nav-inner">
          <Logo />
          <nav className="nav-links" aria-label="Primary">
            {PRIMARY.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-link ${active(link.href) ? "is-active" : ""}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="nav-actions">
            <Link
              href="/status"
              className={`env-chip ${simulated ? "is-simulated" : "is-live"}`}
              title="Environment status"
            >
              <span className="env-dot" />
              {simulated ? "Preview · simulated" : "Base Sepolia"}
            </Link>
            <ConnectButton />
            <button
              className="icon-button nav-menu-button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-label="Open menu"
            >
              {open ? <CloseIcon size={18} /> : <GridIcon size={18} />}
            </button>
          </div>
        </div>
        {open && (
          <div className="menu-sheet">
            <nav aria-label="Secondary">
              {SECONDARY.map((link) => (
                <Link key={`${link.href}-${link.label}`} href={link.href}>
                  {link.label}
                </Link>
              ))}
              <a href="https://x.com/Kyrox_io" target="_blank" rel="noopener noreferrer">
                Follow on X ↗
              </a>
            </nav>
          </div>
        )}
      </header>

      <nav className="mobile-tabs" aria-label="Primary mobile">
        {PRIMARY.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`mobile-tab ${active(link.href) ? "is-active" : ""}`}
            >
              <Icon size={19} />
              <span>{link.label}</span>
            </Link>
          );
        })}
        <Link href="/status" className={`mobile-tab ${active("/status") ? "is-active" : ""}`}>
          <InfoIcon size={19} />
          <span>Status</span>
        </Link>
      </nav>
    </>
  );
}
