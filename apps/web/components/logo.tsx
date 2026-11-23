import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="KYROX home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M16 2.4 27.4 9v14L16 29.6 4.6 23V9L16 2.4Z"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M11 10v12M11 16l7-6M11 16l7 6" stroke="currentColor" strokeWidth="2" />
        </svg>
      </span>
      {!compact && (
        <span className="brand-text">
          <span className="brand-name">KYROX</span>
          <span className="brand-sub">Tokenized equities</span>
        </span>
      )}
    </Link>
  );
}
