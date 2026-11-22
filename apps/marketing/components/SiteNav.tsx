"use client";

import { useEffect, useState } from "react";

import { Logo } from "./Logo";

const LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#security", label: "Security" },
  { href: "#status", label: "Status" },
] as const;

export function SiteNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="wrap header-inner">
          <a className="brand-link" href="#top" aria-label="KYROX home">
            <Logo />
          </a>
          <nav aria-label="Primary" className="desktop-nav">
            <ul>
              {LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href}>{link.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="header-actions">
            <a
              className="button button-small"
              href="https://x.com/Kyrox_io"
              rel="noopener noreferrer"
              target="_blank"
            >
              Follow on X<span aria-hidden="true">↗</span>
            </a>
            <button
              aria-controls="mobile-menu"
              aria-expanded={open}
              aria-label={open ? "Close navigation menu" : "Open navigation menu"}
              className="menu-toggle"
              onClick={() => setOpen((current) => !current)}
              type="button"
            >
              <span aria-hidden="true" className={`menu-icon${open ? " is-open" : ""}`}>
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>
        <nav
          aria-label="Mobile"
          className={`mobile-nav${open ? " is-open" : ""}`}
          hidden={!open}
          id="mobile-menu"
        >
          <ul className="wrap">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} onClick={() => setOpen(false)}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
    </>
  );
}
